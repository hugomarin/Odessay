/**
 * OpenAI configuration for the Workspace Agent's semantic classification
 * vertical.
 *
 * Fireworks remains the provider for the existing corrections and title
 * suggestion routes. This adapter is intentionally separate so adding an
 * OpenAI key for Workspace classification cannot silently change those flows.
 */

export const OPENAI_WORKSPACE_DEFAULT_MODEL = "gpt-5.6-luna"
export const OPENAI_WORKSPACE_MODEL_CAPACITY_REGISTRY_VERSION = "2026-09-13"
export const OPENAI_WORKSPACE_MODEL_CAPACITY_REGISTRY: Readonly<Record<string, number>> = Object.freeze({
  // Exact model IDs/aliases only. Unknown deployment aliases must provide an
  // override instead of inheriting a window from a similarly named model.
  "gpt-6-astra": 1_050_000,
  "gpt-5.6": 1_050_000,
  "gpt-5.6-sol": 1_050_000,
  "gpt-5.6-terra": 1_050_000,
  "gpt-5.6-luna": 1_050_000,
  "gpt-5.5": 1_050_000,
})
export const OPENAI_WORKSPACE_DEFAULT_SAFETY_MARGIN_TOKENS = 8_192
// Merge and contradiction results can contain one evidence-backed item per
// aligned section. 8k was not enough for a real two-document Merge: OpenAI
// returned an incomplete JSON envelope at max_output_tokens. This is an
// output budget, not a document-selection limit; deployments can raise it
// through OPENAI_WORKSPACE_MAX_OUTPUT_TOKENS up to the model's capability.
export const OPENAI_WORKSPACE_DEFAULT_MAX_OUTPUT_TOKENS = 16_384
export const OPENAI_WORKSPACE_MIN_MAX_OUTPUT_TOKENS = 8_192
export const OPENAI_WORKSPACE_DEFAULT_REASONING_EFFORT = "none" as const

const BASE_URL = "https://api.openai.com/v1"
const MAX_SUPPORTED_OUTPUT_TOKENS = 128_000
const SUPPORTED_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const

type OpenAIReasoningEffort = (typeof SUPPORTED_REASONING_EFFORTS)[number]

function readOutputTokenBudget(): number {
  const configured = Number(process.env.OPENAI_WORKSPACE_MAX_OUTPUT_TOKENS)

  if (!Number.isFinite(configured)) {
    return OPENAI_WORKSPACE_DEFAULT_MAX_OUTPUT_TOKENS
  }

  return Math.min(
    MAX_SUPPORTED_OUTPUT_TOKENS,
    Math.max(OPENAI_WORKSPACE_MIN_MAX_OUTPUT_TOKENS, Math.floor(configured)),
  )
}

function readReasoningEffort(): OpenAIReasoningEffort {
  const configured = process.env.OPENAI_WORKSPACE_REASONING_EFFORT?.trim()

  if (configured && (SUPPORTED_REASONING_EFFORTS as readonly string[]).includes(configured)) {
    return configured as OpenAIReasoningEffort
  }

  return OPENAI_WORKSPACE_DEFAULT_REASONING_EFFORT
}

function readOptionalPositiveInteger(name: string): number | null {
  const configured = Number(process.env[name])
  if (!Number.isFinite(configured) || configured <= 0) return null
  return Math.floor(configured)
}

export function resolveOpenAIWorkspaceContextCapacity(model: string, deploymentOverride: number | null) {
  if (deploymentOverride !== null) {
    return {
      contextWindowTokens: deploymentOverride,
      contextCapacitySource: "deployment_override" as const,
      contextCapacityStatus: "known" as const,
    }
  }

  const registered = OPENAI_WORKSPACE_MODEL_CAPACITY_REGISTRY[model]
  if (registered) {
    return {
      contextWindowTokens: registered,
      contextCapacitySource: "model_registry" as const,
      contextCapacityStatus: "known" as const,
    }
  }

  return {
    contextWindowTokens: null,
    contextCapacitySource: "capacity_unknown" as const,
    contextCapacityStatus: "capacity_unknown" as const,
  }
}

export function getOpenAIWorkspaceProviderConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.")
  }

  const model = process.env.OPENAI_WORKSPACE_MODEL?.trim() || OPENAI_WORKSPACE_DEFAULT_MODEL
  const contextCapacity = resolveOpenAIWorkspaceContextCapacity(
    model,
    readOptionalPositiveInteger("OPENAI_WORKSPACE_CONTEXT_WINDOW_TOKENS"),
  )
  const compactionThresholdTokens = readOptionalPositiveInteger("OPENAI_WORKSPACE_COMPACTION_THRESHOLD_TOKENS")
  const historyReserveTokens = readOptionalPositiveInteger("OPENAI_WORKSPACE_HISTORY_RESERVE_TOKENS") ?? 0
  const reasoningReserveTokens = readOptionalPositiveInteger("OPENAI_WORKSPACE_REASONING_RESERVE_TOKENS") ?? 0
  const safetyMarginTokens = readOptionalPositiveInteger("OPENAI_WORKSPACE_SAFETY_MARGIN_TOKENS")
    ?? OPENAI_WORKSPACE_DEFAULT_SAFETY_MARGIN_TOKENS
  return {
    provider: "openai" as const,
    baseUrl: BASE_URL,
    apiKey,
    model,
    responsesUrl: `${BASE_URL}/responses`,
    maxOutputTokens: readOutputTokenBudget(),
    reasoningEffort: readReasoningEffort(),
    // These values are deployment capabilities and operational reserves,
    // not document-count product limits. A deployment override wins over
    // the versioned exact-ID registry; unknown aliases stay explicit.
    ...contextCapacity,
    historyReserveTokens,
    reasoningReserveTokens,
    safetyMarginTokens,
    ...(compactionThresholdTokens ? { compactionThresholdTokens } : {}),
  }
}
