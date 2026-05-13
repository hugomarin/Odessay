/**
 * Fireworks AI provider configuration.
 *
 * Required environment variable:
 *   FIREWORKS_API_KEY  - Your Fireworks API key
 */

const BASE_URL = "https://api.fireworks.ai/inference/v1";
const MODEL = "accounts/fireworks/models/llama-v3p1-8b-instruct";
const MAX_TOKENS = 1000;
const TEMPERATURE = 1.0;
const TOP_P = 0.95;

export function getAIProviderConfig() {
  const apiKey = process.env.FIREWORKS_API_KEY ?? process.env.AI_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("Missing FIREWORKS_API_KEY (or AI_API_KEY) environment variable.");
  }

  return {
    baseUrl: BASE_URL,
    apiKey,
    model: process.env.FIREWORKS_MODEL ?? MODEL,
    chatCompletionsUrl: `${BASE_URL}/chat/completions`,
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    topP: TOP_P,
  };
}
