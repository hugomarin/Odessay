import type {
  ContextAcquisitionPlan,
  ContextBudget,
  ContextIntent,
  ContextRepresentation,
} from "@/lib/services/context/types"

export const DEFAULT_EXTRACTION_POLICY = "full-markdown-v1"

export type PlanCandidateSource = {
  documentId: string
  documentVersion: string
  purpose: string
  /** Lower runs first. */
  priority: number
  required: boolean
  representation?: ContextRepresentation
  extractionPolicy?: string
}

/**
 * Builds a Context Acquisition Plan (odessay-agent-context.md): a set of
 * candidate sources, in priority order, bounded by a budget. `candidates`
 * being empty is a valid, expected plan for a conversational intent with no
 * documentary evidence available — this function never invents a source.
 */
export function buildContextAcquisitionPlan(input: {
  intent: ContextIntent
  candidates: readonly PlanCandidateSource[]
  budget: ContextBudget
  allowAdditionalRetrieval?: boolean
}): ContextAcquisitionPlan {
  return {
    intent: input.intent,
    sources: input.candidates.map((candidate) => ({
      documentId: candidate.documentId,
      documentVersion: candidate.documentVersion,
      purpose: candidate.purpose,
      priority: candidate.priority,
      required: candidate.required,
      representation: candidate.representation ?? "full",
      extractionPolicy: candidate.extractionPolicy ?? DEFAULT_EXTRACTION_POLICY,
    })),
    budget: input.budget,
    allowAdditionalRetrieval: input.allowAdditionalRetrieval ?? false,
  }
}
