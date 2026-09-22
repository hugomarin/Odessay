import { createContextBudgetManager, estimateTokenCount } from "@/lib/services/context/context-budget-manager"
import type { ContextArtifactStore } from "@/lib/services/context/context-artifact-store"
import type { ContextLedger } from "@/lib/services/context/context-ledger"
import type {
  ContextAcquisitionPlan,
  ContextArtifact,
  ContextCitation,
  EvidenceBundle,
  EvidenceBundleEntry,
} from "@/lib/services/context/types"

export type DocumentBodyReadResult =
  | { ok: true; markdown: string; documentVersion: string; citations?: ContextCitation[]; raw?: unknown }
  | { ok: false; errorMessage: string }

/** Reads one document's body for a representation the cache did not already have. */
export type DocumentBodyReader = (documentId: string) => Promise<DocumentBodyReadResult>

/**
 * Resolves a Context Acquisition Plan into an Evidence Bundle
 * (odessay-agent-context.md / odessay-agent-context-cache.md): for every
 * planned source, reuse a cached artifact when the key matches, otherwise
 * read the body once and cache it. Every source consumed — hit or miss — is
 * recorded in the ledger. A source is omitted (never silently dropped) when
 * the read fails or the budget has no room left for it; a `required` source
 * failing stops acquisition immediately, since the caller cannot proceed
 * without it.
 */
export async function resolveEvidenceBundle(
  plan: ContextAcquisitionPlan,
  deps: {
    store: ContextArtifactStore
    ledger: ContextLedger
    readBody: DocumentBodyReader
  },
): Promise<EvidenceBundle> {
  const budgetManager = createContextBudgetManager(plan.budget)
  const entries: EvidenceBundleEntry[] = []
  const omitted: EvidenceBundle["omitted"] = []
  const orderedSources = [...plan.sources].sort((left, right) => left.priority - right.priority)

  for (const source of orderedSources) {
    const cached = deps.store.get({
      documentId: source.documentId,
      documentVersion: source.documentVersion,
      representation: source.representation,
      extractionPolicy: source.extractionPolicy,
    })

    if (cached) {
      if (!budgetManager.canAdd(cached.byteCount, cached.tokenCount)) {
        omitted.push({ documentId: source.documentId, reason: "budget_exhausted" })
        deps.ledger.record({
          ts: Date.now(),
          documentId: source.documentId,
          documentVersion: source.documentVersion,
          representation: source.representation,
          tokens: 0,
          cacheHit: true,
          reason: "omitted: budget exhausted",
        })
        if (source.required) break
        continue
      }

      budgetManager.add(cached.byteCount, cached.tokenCount)
      entries.push(evidenceEntryFrom(cached, true))
      deps.ledger.record({
        ts: Date.now(),
        documentId: source.documentId,
        documentVersion: source.documentVersion,
        representation: source.representation,
        tokens: cached.tokenCount,
        cacheHit: true,
        reason: source.purpose,
      })
      continue
    }

    const read = await deps.readBody(source.documentId)
    if (!read.ok) {
      omitted.push({ documentId: source.documentId, reason: read.errorMessage })
      if (source.required) {
        return { intent: plan.intent, entries, omitted, budgetExhausted: budgetManager.isExhausted() }
      }
      continue
    }

    const byteCount = read.markdown.length
    const tokenCount = estimateTokenCount(read.markdown)
    if (!budgetManager.canAdd(byteCount, tokenCount)) {
      omitted.push({ documentId: source.documentId, reason: "budget_exhausted" })
      deps.ledger.record({
        ts: Date.now(),
        documentId: source.documentId,
        documentVersion: read.documentVersion,
        representation: source.representation,
        tokens: 0,
        cacheHit: false,
        reason: "omitted: budget exhausted",
      })
      if (source.required) break
      continue
    }

    const artifact: ContextArtifact = {
      documentId: source.documentId,
      documentVersion: read.documentVersion,
      representation: source.representation,
      content: read.markdown,
      citations: read.citations ?? [],
      tokenCount,
      byteCount,
      createdAt: Date.now(),
      extractionPolicy: source.extractionPolicy,
      raw: read.raw,
    }
    deps.store.set(artifact)
    budgetManager.add(byteCount, tokenCount)
    entries.push(evidenceEntryFrom(artifact, false))
    deps.ledger.record({
      ts: Date.now(),
      documentId: source.documentId,
      documentVersion: read.documentVersion,
      representation: source.representation,
      tokens: tokenCount,
      cacheHit: false,
      reason: source.purpose,
    })
  }

  return { intent: plan.intent, entries, omitted, budgetExhausted: budgetManager.isExhausted() }
}

function evidenceEntryFrom(artifact: ContextArtifact, cacheHit: boolean): EvidenceBundleEntry {
  return {
    documentId: artifact.documentId,
    documentVersion: artifact.documentVersion,
    representation: artifact.representation,
    content: artifact.content,
    citations: artifact.citations,
    cacheHit,
    raw: artifact.raw,
    provenance: { extractionPolicy: artifact.extractionPolicy, createdAt: artifact.createdAt },
  }
}
