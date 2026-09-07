import { describe, expect, it, vi } from "vitest"
import { createContextArtifactStore } from "@/lib/services/context/context-artifact-store"
import { createContextLedger } from "@/lib/services/context/context-ledger"
import { buildContextAcquisitionPlan } from "@/lib/services/context/context-acquisition-planner"
import { resolveEvidenceBundle, type DocumentBodyReader } from "@/lib/services/context/context-resolver"
import type { ContextBudget } from "@/lib/services/context/types"

const GENEROUS_BUDGET: ContextBudget = {
  maxInputTokens: 100_000,
  maxDocuments: 10,
  maxBytes: 100_000,
  maxRetrievalRounds: 1,
}

function reader(bodies: Record<string, string>, versions: Record<string, string> = {}): DocumentBodyReader {
  const readFn = vi.fn(async (documentId: string) => {
    const markdown = bodies[documentId]
    if (markdown === undefined) return { ok: false as const, errorMessage: `Document ${documentId} could not be read.` }
    return { ok: true as const, markdown, documentVersion: versions[documentId] ?? "v1", raw: { documentId } }
  })
  return readFn
}

describe("context acquisition planner", () => {
  it("produces an empty plan for a conversational intent with no candidate sources — 'Hola' reads zero documents", () => {
    const plan = buildContextAcquisitionPlan({
      intent: "conversation",
      candidates: [],
      budget: GENEROUS_BUDGET,
    })

    expect(plan.sources).toEqual([])
    expect(plan.intent).toBe("conversation")
  })
})

describe("resolveEvidenceBundle — cache hit/miss", () => {
  it("misses the cache on the first read and hits it on a repeated question for the same document version", async () => {
    const store = createContextArtifactStore()
    const ledger = createContextLedger()
    const readBody = reader({ doc1: "# Doc one\n\nContent." })

    const plan = buildContextAcquisitionPlan({
      intent: "understand",
      candidates: [{ documentId: "doc1", documentVersion: "v1", purpose: "ask", priority: 0, required: true }],
      budget: GENEROUS_BUDGET,
    })

    const first = await resolveEvidenceBundle(plan, { store, ledger, readBody })
    expect(first.entries).toHaveLength(1)
    expect(first.entries[0].cacheHit).toBe(false)
    expect(readBody).toHaveBeenCalledTimes(1)

    const second = await resolveEvidenceBundle(plan, { store, ledger, readBody })
    expect(second.entries).toHaveLength(1)
    expect(second.entries[0].cacheHit).toBe(true)
    expect(second.entries[0].content).toBe("# Doc one\n\nContent.")
    // No recomputation of the full representation on the repeated question.
    expect(readBody).toHaveBeenCalledTimes(1)

    const ledgerEntries = ledger.entries()
    expect(ledgerEntries).toHaveLength(2)
    expect(ledgerEntries[0].cacheHit).toBe(false)
    expect(ledgerEntries[1].cacheHit).toBe(true)
  })

  it("invalidates the cached artifact when the document version changes, so a stale artifact is never served as current evidence", async () => {
    const store = createContextArtifactStore()
    const ledger = createContextLedger()
    const readBody = reader(
      { doc1: "v1 content" },
      { doc1: "v1" },
    )

    const planV1 = buildContextAcquisitionPlan({
      intent: "understand",
      candidates: [{ documentId: "doc1", documentVersion: "v1", purpose: "ask", priority: 0, required: true }],
      budget: GENEROUS_BUDGET,
    })
    await resolveEvidenceBundle(planV1, { store, ledger, readBody })
    expect(readBody).toHaveBeenCalledTimes(1)

    // Content changes to v2 — a fresh read is required, the v1 artifact is never returned.
    const readBodyV2 = reader({ doc1: "v2 content, changed" }, { doc1: "v2" })
    const planV2 = buildContextAcquisitionPlan({
      intent: "understand",
      candidates: [{ documentId: "doc1", documentVersion: "v2", purpose: "ask", priority: 0, required: true }],
      budget: GENEROUS_BUDGET,
    })
    const secondResult = await resolveEvidenceBundle(planV2, { store, ledger, readBody: readBodyV2 })

    expect(readBodyV2).toHaveBeenCalledTimes(1)
    expect(secondResult.entries[0].cacheHit).toBe(false)
    expect(secondResult.entries[0].content).toBe("v2 content, changed")
  })

  it("stops on a required source once the byte budget is exhausted, instead of retrieving without limit", async () => {
    const store = createContextArtifactStore()
    const ledger = createContextLedger()
    const readBody = reader({ big: "x".repeat(1_000) })

    const plan = buildContextAcquisitionPlan({
      intent: "understand",
      candidates: [{ documentId: "big", documentVersion: "v1", purpose: "ask", priority: 0, required: true }],
      budget: { maxInputTokens: 100_000, maxDocuments: 10, maxBytes: 10, maxRetrievalRounds: 1 },
    })

    const result = await resolveEvidenceBundle(plan, { store, ledger, readBody })

    expect(result.entries).toHaveLength(0)
    expect(result.omitted).toEqual([{ documentId: "big", reason: "budget_exhausted" }])
    expect(result.budgetExhausted).toBe(false)
  })

  it("omits a non-required source over budget but keeps resolving the rest of the plan", async () => {
    const store = createContextArtifactStore()
    const ledger = createContextLedger()
    const readBody = reader({ small: "short", big: "x".repeat(1_000) })

    const plan = buildContextAcquisitionPlan({
      intent: "understand",
      candidates: [
        { documentId: "big", documentVersion: "v1", purpose: "extra", priority: 0, required: false },
        { documentId: "small", documentVersion: "v1", purpose: "primary", priority: 1, required: true },
      ],
      budget: { maxInputTokens: 100_000, maxDocuments: 10, maxBytes: 10, maxRetrievalRounds: 1 },
    })

    const result = await resolveEvidenceBundle(plan, { store, ledger, readBody })

    expect(result.entries.map((entry) => entry.documentId)).toEqual(["small"])
    expect(result.omitted).toEqual([{ documentId: "big", reason: "budget_exhausted" }])
  })

  it("stops acquisition when a required source fails to read, without reading the remaining sources", async () => {
    const store = createContextArtifactStore()
    const ledger = createContextLedger()
    const readBody = reader({ second: "content" })

    const plan = buildContextAcquisitionPlan({
      intent: "understand",
      candidates: [
        { documentId: "missing", documentVersion: "v1", purpose: "ask", priority: 0, required: true },
        { documentId: "second", documentVersion: "v1", purpose: "ask", priority: 1, required: true },
      ],
      budget: GENEROUS_BUDGET,
    })

    const result = await resolveEvidenceBundle(plan, { store, ledger, readBody })

    expect(result.entries).toEqual([])
    expect(result.omitted).toEqual([{ documentId: "missing", reason: "Document missing could not be read." }])
    expect(readBody).not.toHaveBeenCalledWith("second")
  })
})
