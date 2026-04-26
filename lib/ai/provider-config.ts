/**
 * Generic OpenAI-compatible AI provider configuration.
 * Supports Cerebras, Fireworks, Together, OpenRouter, or any OpenAI-compatible API.
 *
 * Required environment variables:
 *   AI_BASE_URL    - e.g. https://api.cerebras.ai/v1
 *   AI_API_KEY     - e.g. sk-cerebras-...
 *   AI_MODEL       - e.g. zai-glm-4.7
 *
 * Optional:
 *   AI_MAX_TOKENS  - default 1000
 *   AI_TEMPERATURE - default 1.0
 *   AI_TOP_P       - default 0.95
 */

export function getAIProviderConfig() {
  // Support generic AI_* vars or Cerebras-specific CEREBRAS_* vars
  const baseUrl = (process.env.AI_BASE_URL ?? process.env.CEREBRAS_BASE_URL)?.replace(/\/$/, "") ?? "";
  const apiKey = process.env.AI_API_KEY ?? process.env.CEREBRAS_API_KEY ?? "";
  const model = process.env.AI_MODEL ?? process.env.CEREBRAS_MODEL ?? "";

  if (!baseUrl || !apiKey || !model) {
    const missing = [
      !baseUrl && "AI_BASE_URL (or CEREBRAS_BASE_URL)",
      !apiKey && "AI_API_KEY (or CEREBRAS_API_KEY)",
      !model && "AI_MODEL (or CEREBRAS_MODEL)",
    ].filter(Boolean);

    throw new Error(`Missing AI provider config: ${missing.join(", ")}`);
  }

  return {
    baseUrl,
    apiKey,
    model,
    chatCompletionsUrl: `${baseUrl}/chat/completions`,
    maxCompletionTokens: Number(process.env.AI_MAX_TOKENS ?? process.env.CEREBRAS_MAX_TOKENS ?? 1000),
    temperature: Number(process.env.AI_TEMPERATURE ?? process.env.CEREBRAS_TEMPERATURE ?? 1.0),
    topP: Number(process.env.AI_TOP_P ?? process.env.CEREBRAS_TOP_P ?? 0.95),
  };
}
