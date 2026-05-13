import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildTitleSuggestionUserPrompt,
  extractTitleSuggestionJson,
  hasEnoughTitleSuggestionContent,
  titleSuggestionResponseSchema,
} from "@/lib/ai/title-suggestions";
import { getAIProviderConfig } from "@/lib/ai/provider-config";

describe("title suggestions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires enough body content before allowing AI suggestions", () => {
    expect(hasEnoughTitleSuggestionContent("too short")).toBe(false);
    expect(
      hasEnoughTitleSuggestionContent(
        "This draft has enough words to let the assistant infer a faithful working title.",
      ),
    ).toBe(true);
  });

  it("builds a bounded title suggestion prompt", () => {
    const prompt = buildTitleSuggestionUserPrompt({
      currentTitle: "Untitled writing",
      bodyText: "A ".repeat(7000),
    });

    expect(prompt).toContain("Current title: Untitled writing");
    expect(prompt.length).toBeLessThan(6200);
  });

  it("extracts and validates the JSON title payload", () => {
    const json = extractTitleSuggestionJson('```json\n{"title":"A Better Name"}\n```');
    const parsed = titleSuggestionResponseSchema.parse(JSON.parse(json));

    expect(parsed.title).toBe("A Better Name");
  });

  it("uses Fireworks configuration for AI requests", () => {
    vi.stubEnv("FIREWORKS_API_KEY", "fw-test");
    vi.stubEnv("FIREWORKS_MODEL", "accounts/example/models/custom");

    const config = getAIProviderConfig();

    expect(config.baseUrl).toBe("https://api.fireworks.ai/inference/v1");
    expect(config.chatCompletionsUrl).toBe("https://api.fireworks.ai/inference/v1/chat/completions");
    expect(config.model).toBe("accounts/example/models/custom");
  });
});
