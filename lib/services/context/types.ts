/**
 * Shared-core types for the Workspace Agent's context acquisition, cache and
 * budget layer (ODE-501). These implement the contracts described in
 * workflow/context/features/agents/odessay-agent-context.md and
 * odessay-agent-context-cache.md: a lazy Context Acquisition Plan is resolved
 * into an Evidence Bundle, reusing versioned artifacts from a
 * ContextArtifactStore and recording every source consumed in a
 * ContextLedger, bounded by a ContextBudget.
 */

export type ContextRepresentation = "metadata" | "summary" | "facts" | "chunks" | "full"

export type ContextIntent = "conversation" | "understand" | "generate" | "tool" | "workflow"

/** documentId + documentVersion + representation + extractionPolicy is the cache key (per odessay-agent-context-cache.md). */
export type ContextArtifactKey = {
  documentId: string
  documentVersion: string
  representation: ContextRepresentation
  extractionPolicy: string
}

export type ContextCitation = {
  quote: string
  reason?: string
}

/**
 * A versioned, derived artifact. `raw` is opaque to this layer — it lets a
 * caller round-trip whatever metadata it needs alongside the cached content
 * (e.g. the DocumentCatalogRecord as of the read) without this module
 * depending on any concrete catalog/document shape.
 */
export type ContextArtifact = {
  documentId: string
  documentVersion: string
  representation: ContextRepresentation
  content: string
  citations: ContextCitation[]
  tokenCount: number
  byteCount: number
  createdAt: number
  extractionPolicy: string
  raw?: unknown
}

export type ContextBudget = {
  maxInputTokens: number
  maxDocuments: number
  maxBytes: number
  maxRetrievalRounds: number
}

export type ContextSourceRequest = {
  documentId: string
  documentVersion: string
  purpose: string
  priority: number
  required: boolean
  representation: ContextRepresentation
  extractionPolicy: string
}

export type ContextAcquisitionPlan = {
  intent: ContextIntent
  sources: ContextSourceRequest[]
  budget: ContextBudget
  allowAdditionalRetrieval: boolean
}

export type EvidenceBundleEntry = {
  documentId: string
  documentVersion: string
  representation: ContextRepresentation
  content: string
  citations: ContextCitation[]
  cacheHit: boolean
  raw?: unknown
  provenance: {
    extractionPolicy: string
    createdAt: number
  }
}

export type EvidenceOmission = {
  documentId: string
  reason: string
}

export type EvidenceBundle = {
  intent: ContextIntent
  entries: EvidenceBundleEntry[]
  omitted: EvidenceOmission[]
  budgetExhausted: boolean
}

export type ContextLedgerEntry = {
  ts: number
  documentId: string
  documentVersion: string | null
  representation: ContextRepresentation
  tokens: number
  cacheHit: boolean
  reason: string
}
