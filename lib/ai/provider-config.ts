/**
 * Fireworks AI provider configuration.
 *
 * Required environment variable:
 *   FIREWORKS_API_KEY  - Your Fireworks API key
 *   FIREWORKS_MODEL    - A model id available in your Fireworks account
 */

const BASE_URL = "https://api.fireworks.ai/inference/v1";
// 1000 is too low for any structured JSON response on real content — truncates mid-object.
// Override with FIREWORKS_MAX_TOKENS if needed; minimum safe floor is 4096 for corrections.
const MAX_TOKENS = Number(process.env.FIREWORKS_MAX_TOKENS ?? 4096);
const TEMPERATURE = 1.0;
const TOP_P = 0.95;

export function getAIProviderConfig() {
  const apiKey = process.env.FIREWORKS_API_KEY ?? process.env.AI_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("Missing FIREWORKS_API_KEY (or AI_API_KEY) environment variable.");
  }

  const model = process.env.FIREWORKS_MODEL?.trim() ?? "";

  if (!model) {
    throw new Error("Missing FIREWORKS_MODEL environment variable. Set it to a model id available in Fireworks.");
  }

  return {
    baseUrl: BASE_URL,
    apiKey,
    model,
    chatCompletionsUrl: `${BASE_URL}/chat/completions`,
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    topP: TOP_P,
  };
}
