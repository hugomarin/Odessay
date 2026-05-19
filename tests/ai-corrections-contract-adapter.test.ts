import { describe, expect, it } from "vitest";
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter";

describe("AI corrections contract adapter", () => {
  it("keeps the canonical contract readable while exposing legacy suggestions", () => {
    const adapted = adaptCorrectionsContract({
      summary: "Two mechanical corrections found.",
      language: "es",
      corrections: [
        {
          blockId: "block-a",
          type: "accent",
          severity: "medium",
          confidence: "high",
          originalText: "cancion",
          replacementText: "canción",
          reason: "Missing accent.",
        },
        {
          blockId: "block-b",
          type: "basic_redaction",
          severity: "low",
          confidence: "medium",
          originalText: "the sentence are",
          replacementText: "the sentence is",
          reason: "Repair agreement.",
        },
      ],
      uncertain: [
        {
          blockId: "block-c",
          text: "Odessay",
          reason: "Product term.",
          possibleReplacement: null,
        },
      ],
    });

    expect(adapted.canonical.language).toBe("es");
    expect(adapted.canonical.corrections).toHaveLength(2);
    expect(adapted.legacy.summary).toBe("Two mechanical corrections found.");
    expect(adapted.legacy.suggestions).toMatchObject([
      {
        kind: "spelling",
        title: "Fix accent",
        original_text: "cancion",
        replacement_text: "canción",
        status: "pending",
      },
      {
        kind: "rewriting",
        title: "Repair phrase",
        original_text: "the sentence are",
        replacement_text: "the sentence is",
        status: "pending",
      },
    ]);
    expect(adapted.legacy.suggestions[0]?.id).toMatch(/^correction:block-a:/);
    expect(adapted.legacy.suggestions[1]?.id).toMatch(/^correction:block-b:/);
    expect(adapted.legacy.checklist).toEqual([
      {
        id: "uncertain-1",
        label: "Review uncertain text",
        detail: "Product term.",
        target_text: "Odessay",
        status: "pending",
      },
    ]);
  });

  it("converts the existing publication-review response into canonical form", () => {
    const adapted = adaptCorrectionsContract({
      summary: "Ready after one fix.",
      spelling: [
        {
          title: "Fix spelling",
          reason: "Typo.",
          originalText: "recieve",
          replacementText: "receive",
        },
      ],
      rewriting: [],
      checklist: [
        {
          label: "Check name",
          detail: "May be a proper noun.",
          targetText: "Linear",
        },
      ],
    });

    expect(adapted.legacy.suggestions[0]).toMatchObject({
      id: "spelling-1",
      kind: "spelling",
      original_text: "recieve",
      replacement_text: "receive",
    });
    expect(adapted.canonical).toMatchObject({
      summary: "Ready after one fix.",
      language: "unknown",
      corrections: [
        {
          blockId: "legacy-publication-review",
          type: "spelling",
          severity: "low",
          confidence: "medium",
          originalText: "recieve",
          replacementText: "receive",
        },
      ],
      uncertain: [
        {
          blockId: "legacy-publication-review",
          text: "Linear",
          reason: "May be a proper noun.",
          possibleReplacement: null,
        },
      ],
    });
  });

  it("drops incomplete correction items deterministically", () => {
    const adapted = adaptCorrectionsContract({
      summary: "",
      language: "en",
      corrections: [
        {
          blockId: "block-a",
          type: "spelling",
          severity: "low",
          confidence: "high",
          originalText: "",
          replacementText: "receive",
          reason: "Typo.",
        },
      ],
      uncertain: [
        {
          blockId: "block-b",
          text: "",
          reason: "Missing target.",
          possibleReplacement: null,
        },
      ],
    });

    expect(adapted.legacy.suggestions).toEqual([]);
    expect(adapted.legacy.checklist).toEqual([]);
  });

  it("preserves grammar and punctuation kinds in legacy suggestions", () => {
    const adapted = adaptCorrectionsContract({
      summary: "Two mechanical corrections found.",
      language: "es",
      corrections: [
        {
          blockId: "block-a",
          type: "grammar",
          severity: "medium",
          confidence: "high",
          originalText: "fuimos",
          replacementText: "íbamos",
          reason: "Verb agreement.",
        },
        {
          blockId: "block-b",
          type: "punctuation",
          severity: "low",
          confidence: "medium",
          originalText: "hola mundo",
          replacementText: "hola, mundo",
          reason: "Missing comma.",
        },
      ],
      uncertain: [],
    });

    expect(adapted.legacy.suggestions).toMatchObject([
      {
        kind: "grammar",
        original_text: "fuimos",
        replacement_text: "íbamos",
      },
      {
        kind: "punctuation",
        original_text: "hola mundo",
        replacement_text: "hola, mundo",
      },
    ]);
  });

  it("creates stable non-index ids for repeated canonical corrections", () => {
    const adapted = adaptCorrectionsContract({
      summary: "Two repeated fixes.",
      language: "en",
      corrections: [
        {
          blockId: "block-a",
          type: "duplication",
          severity: "medium",
          confidence: "high",
          originalText: "the the",
          replacementText: "the",
        },
        {
          blockId: "block-a",
          type: "duplication",
          severity: "medium",
          confidence: "high",
          originalText: "the the",
          replacementText: "the",
        },
      ],
      uncertain: [],
    });

    expect(adapted.legacy.suggestions.map((suggestion) => suggestion.id)).toEqual([
      expect.stringMatching(/^correction:block-a:/),
      expect.stringMatching(/^correction:block-a:/),
    ]);
    expect(adapted.legacy.suggestions[0]?.id).not.toBe(adapted.legacy.suggestions[1]?.id);
    expect(adapted.legacy.suggestions.map((suggestion) => suggestion.occurrence)).toEqual([0, 1]);
  });
});
