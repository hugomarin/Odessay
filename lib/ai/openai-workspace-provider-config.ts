/**
 * OpenAI configuration for the Workspace Agent's semantic classification
 * vertical.
 *
 * Fireworks remains the provider for the existing corrections and title
 * suggestion routes. This adapter is intentionally separate so adding an
 * OpenAI key for Workspace classification cannot silently change those flows.
 */

export const OPENAI_WORKSPACE_DEFAULT_MODEL = "gpt-5.6-luna"
export const OPENAI_WORKSPACE_DEFAULT_MAX_OUTPUT_TOKENS = 8_192
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
    Math.max(OPENAI_WORKSPACE_DEFAULT_MAX_OUTPUT_TOKENS, Math.floor(configured)),
  )
}

function readReasoningEffort(): OpenAIReasoningEffort {
  const configured = process.env.OPENAI_WORKSPACE_REASONING_EFFORT?.trim()

  if (configured && (SUPPORTED_REASONING_EFFORTS as readonly string[]).includes(configured)) {
    return configured as OpenAIReasoningEffort
  }

  return OPENAI_WORKSPACE_DEFAULT_REASONING_EFFORT
}

export function getOpenAIWorkspaceProviderConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.")
  }

  return {
    provider: "openai" as const,
    baseUrl: BASE_URL,
    apiKey,
    model: process.env.OPENAI_WORKSPACE_MODEL?.trim() || OPENAI_WORKSPACE_DEFAULT_MODEL,
    responsesUrl: `${BASE_URL}/responses`,
    maxOutputTokens: readOutputTokenBudget(),
    reasoningEffort: readReasoningEffort(),
  }
}
