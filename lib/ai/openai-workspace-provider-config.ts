/**
 * OpenAI configuration for the Workspace Agent's semantic classification
 * vertical.
 *
 * Fireworks remains the provider for the existing corrections and title
 * suggestion routes. This adapter is intentionally separate so adding an
 * OpenAI key for Workspace classification cannot silently change those flows.
 */

export const OPENAI_WORKSPACE_DEFAULT_MODEL = "gpt-5.6-luna"
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

export function getOpenAIWorkspaceProviderConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.")
  }

  const contextWindowTokens = readOptionalPositiveInteger("OPENAI_WORKSPACE_CONTEXT_WINDOW_TOKENS")
  const compactionThresholdTokens = readOptionalPositiveInteger("OPENAI_WORKSPACE_COMPACTION_THRESHOLD_TOKENS")
  return {
    provider: "openai" as const,
    baseUrl: BASE_URL,
    apiKey,
    model: process.env.OPENAI_WORKSPACE_MODEL?.trim() || OPENAI_WORKSPACE_DEFAULT_MODEL,
    responsesUrl: `${BASE_URL}/responses`,
    maxOutputTokens: readOutputTokenBudget(),
    reasoningEffort: readReasoningEffort(),
    // These values are deployment capabilities, not product limits. We do
    // not guess a context window for a model that has not declared one.
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(compactionThresholdTokens ? { compactionThresholdTokens } : {}),
  }
}
