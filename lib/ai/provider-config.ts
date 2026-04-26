/**
 * Cerebras GLM 4.7 provider configuration.
 *
 * Required environment variable:
 *   CEREBRAS_API_KEY  - Your Cerebras API key
 */

const BASE_URL = "https://api.cerebras.ai/v1";
const MODEL = "gpt-oss-120b";
const MAX_COMPLETION_TOKENS = 1000;
const TEMPERATURE = 1.0;
const TOP_P = 0.95;

export function getAIProviderConfig() {
  const apiKey = process.env.CEREBRAS_API_KEY ?? process.env.AI_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("Missing CEREBRAS_API_KEY (or AI_API_KEY) environment variable.");
  }

  return {
    baseUrl: BASE_URL,
    apiKey,
    model: MODEL,
    chatCompletionsUrl: `${BASE_URL}/chat/completions`,
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    temperature: TEMPERATURE,
    topP: TOP_P,
  };
}
