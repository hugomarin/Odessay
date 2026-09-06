import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getOpenAIWorkspaceProviderConfig,
  OPENAI_WORKSPACE_DEFAULT_MODEL,
} from "@/lib/ai/openai-workspace-provider-config"

describe("OpenAI Workspace provider configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses GPT-5.6 Luna by default when only the API key is provided", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key")

    expect(getOpenAIWorkspaceProviderConfig()).toEqual({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-test-key",
      model: OPENAI_WORKSPACE_DEFAULT_MODEL,
      responsesUrl: "https://api.openai.com/v1/responses",
      maxOutputTokens: 8_192,
      reasoningEffort: "none",
    })
  })

  it("does not use legacy or Fireworks keys as a fallback", () => {
    vi.stubEnv("AI_API_KEY", "legacy-key")
    vi.stubEnv("FIREWORKS_API_KEY", "fireworks-key")

    expect(() => getOpenAIWorkspaceProviderConfig()).toThrow("Missing OPENAI_API_KEY")
  })

  it("allows operational model, reasoning and output-budget overrides", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key")
    vi.stubEnv("OPENAI_WORKSPACE_MODEL", "gpt-5.6-luna-custom")
    vi.stubEnv("OPENAI_WORKSPACE_REASONING_EFFORT", "low")
    vi.stubEnv("OPENAI_WORKSPACE_MAX_OUTPUT_TOKENS", "12000")

    expect(getOpenAIWorkspaceProviderConfig()).toMatchObject({
      model: "gpt-5.6-luna-custom",
      reasoningEffort: "low",
      maxOutputTokens: 12_000,
    })
  })
})
