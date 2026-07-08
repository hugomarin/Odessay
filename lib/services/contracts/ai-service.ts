import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type TitleSuggestionRequest = {
  currentTitle: string
  bodyText: string
  writingId?: string
}

export type TitleSuggestion = {
  title: string
  rationale: string | null
}

export type CorrectionMemoryEntry = {
  fingerprint: string
  decision: "accepted" | "rejected"
  decidedAt: string
}

export type LearnedWordLanguage = "es" | "en" | "mixed" | "unknown"

export type LearnedWordEntry = {
  id: string
  word: string
  language: LearnedWordLanguage
  createdAt: string
}

export type LearnedWordsPage = {
  items: LearnedWordEntry[]
  nextCursor: string | null
}

export type CorrectionBlockInput = {
  id: string
  text: string
  hash: string
}

export type MechanicalCorrectionKind =
  | "spelling"
  | "accent"
  | "grammar"
  | "agreement"
  | "punctuation"
  | "duplication"
  | "spacing"
  | "basic_redaction"

export type MechanicalCorrection = {
  blockId: string
  type: MechanicalCorrectionKind
  severity?: "low" | "medium" | "high"
  confidence?: "high" | "medium"
  originalText: string
  replacementText: string
}

export type MechanicalUncertainNote = {
  blockId: string
  text: string
  reason: string
  possibleReplacement: string | null
}

export type PersistedCorrectionSuggestionKind = "spelling" | "grammar" | "punctuation" | "rewriting"

export type PersistedCorrectionSuggestionStatus =
  | "pending"
  | "pending-stale"
  | "accepted"
  | "rejected"
  | "conflict"

export type PersistedCorrectionSuggestion = {
  id: string
  kind: PersistedCorrectionSuggestionKind
  mechanical_type?: MechanicalCorrectionKind | null
  title: string
  reason: string
  original_text: string
  replacement_text: string
  context_before?: string | null
  context_after?: string | null
  occurrence?: number | null
  block_id?: string | null
  source_hash?: string | null
  correction_fingerprint?: string | null
  status: PersistedCorrectionSuggestionStatus
}

export type PublicationReviewRequest = {
  writingId?: string
  title: string
  markdown: string
  bodyText: string
  sourceHash: string
  correctionBlock?: CorrectionBlockInput
  correctionBlocks: CorrectionBlockInput[]
  correctionMemory?: {
    entries: CorrectionMemoryEntry[]
  }
  learnedWords?: {
    entries: Array<{
      word: string
      language?: LearnedWordLanguage | null
    }>
  }
  stream?: boolean
}

export type AiUsage = {
  model: string
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number | null
}

export type PublicationReviewResult = {
  summary: string
  language: string
  corrections: MechanicalCorrection[]
  uncertain: MechanicalUncertainNote[]
  usage: AiUsage | null
}

export type PersistedCorrectionBlock = {
  id: string
  writingId: string
  blockId: string
  blockHash: string
  suggestions: PersistedCorrectionSuggestion[]
  model: string
  createdAt: string
  latencyMs: number | null
  promptTokens: number | null
  completionTokens: number | null
  syncedAt: string | null
}

export type PersistCorrectionBlockInput = {
  writingId?: string
  block?: PersistedCorrectionBlock
  deletedBlockIds?: string[]
}

export type PersistCorrectionBlockResult = {
  persistedId: string | null
  deletedIds: string[]
  syncedAt: string
}

export type ListLearnedWordsInput = {
  limit?: number
  cursor?: string | null
}

export type LearnWordInput = {
  word: string
  language?: LearnedWordLanguage | null
}

export interface AIService {
  suggestTitle(input: TitleSuggestionRequest): Promise<ServiceResponse<TitleSuggestion>>
  reviewPublication(input: PublicationReviewRequest): Promise<ServiceResponse<PublicationReviewResult>>
  hydrateCorrectionBlocks(writingId: string): Promise<ServiceResponse<PersistedCorrectionBlock[]>>
  persistCorrectionBlock(input: PersistCorrectionBlockInput): Promise<ServiceResponse<PersistCorrectionBlockResult>>
  listLearnedWords(input?: ListLearnedWordsInput): Promise<ServiceResponse<LearnedWordsPage>>
  learnWord(input: LearnWordInput): Promise<ServiceResponse<LearnedWordEntry>>
  deleteLearnedWord(id: string): Promise<ServiceResponse<{ deletedId: string }>>
}

export const AI_SERVICE_CONTRACT = {
  name: "AIService",
  summary:
    "Remote capability boundary for title suggestions, publication review, and correction-block persistence without exposing provider URLs, HTTP payloads, or session mechanics to the product layer.",
  responsibilities: [
    "Treat AI as a capability contract, not as direct route-handler code or provider-specific fetch logic.",
    "Keep model usage, structured output, and correction memory explicit in the contract so adapters can vary by runtime.",
    "Isolate correction hydration and persistence as part of the same AI capability boundary used by publication review flows.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "cloud", "desktop"],
  owner: "architecture-first",
  invariants: [
    "AIService can be unavailable or remote-only, but that optionality must be represented through ServiceResponse rather than hidden fetch failures.",
    "Provider endpoints, API keys, and structured-output quirks belong to adapters, not to shared core callers.",
    "Correction persistence is a capability concern adjacent to AI review and must not leak local cache or HTTP route details into the contract.",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "suggestTitle",
      kind: "command",
      summary: "Request a title suggestion from the active AI adapter.",
      input: ["currentTitle", "bodyText"],
      output: ["TitleSuggestion"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "RATE_LIMITED", "AI_REQUEST_FAILED", "UNAVAILABLE"],
    },
    {
      name: "reviewPublication",
      kind: "stream",
      summary: "Run the mechanical publication-review flow for up to one correction-block batch and return normalized corrections.",
      input: ["PublicationReviewRequest including correctionBlocks, correction memory, and optional stream flag"],
      output: ["PublicationReviewResult"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "RATE_LIMITED", "TIMEOUT", "AI_REQUEST_FAILED"],
    },
    {
      name: "hydrateCorrectionBlocks",
      kind: "query",
      summary: "Load persisted correction blocks for a writing through the active remote capability.",
      input: ["writingId"],
      output: ["PersistedCorrectionBlock[]"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "UNAVAILABLE"],
    },
    {
      name: "persistCorrectionBlock",
      kind: "command",
      summary: "Persist or delete correction-block state without exposing correction routes or local DB details.",
      input: ["PersistCorrectionBlockInput"],
      output: ["PersistCorrectionBlockResult"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "UNAVAILABLE", "AI_REQUEST_FAILED"],
    },
    {
      name: "listLearnedWords",
      kind: "query",
      summary: "Load the current user's learned-word dictionary with pagination support.",
      input: ["optional cursor and limit"],
      output: ["LearnedWordsPage"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "UNAVAILABLE"],
    },
    {
      name: "learnWord",
      kind: "command",
      summary: "Persist a learned word for the current user.",
      input: ["word", "optional language"],
      output: ["LearnedWordEntry"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "UNAVAILABLE"],
    },
    {
      name: "deleteLearnedWord",
      kind: "command",
      summary: "Remove a learned word from the current user's dictionary.",
      input: ["learned word id"],
      output: ["deletedId"],
      errorCodes: ["UNAUTHORIZED", "NOT_FOUND", "UNAVAILABLE"],
    },
  ],
  hotspots: [
    {
      id: "ai-title-suggestions",
      summary: "Title suggestions are currently modeled as a web route plus direct provider fetch logic.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/ai/title-suggestions/route.ts",
        "lib/ai/title-suggestions.ts",
      ],
    },
    {
      id: "publication-review",
      summary: "Publication review already has product semantics, but provider transport and structured-output retries still live inside the web adapter.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/ai/publication-review/route.ts",
        "lib/ai/corrections.ts",
        "lib/ai/corrections-contract-adapter.ts",
      ],
    },
    {
      id: "correction-block-persistence",
      summary: "Correction-block hydration and persistence are client helpers that still talk directly to /api routes.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "lib/corrections/persistence.ts",
        "lib/local-db/schema.ts",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"AIService", keyof AIService>
