import { describe, expect, it } from "vitest";
import {
  buildMechanicalCorrectionsPrompt,
  hashCorrectionBlock,
  normalizeCanonicalCorrections,
} from "../lib/ai/corrections";
import { createCorrectionFingerprint, filterCorrectionsByMemory } from "../lib/ai/correction-memory";
import { adaptCanonicalCorrectionsToPublicationReview } from "../lib/ai/corrections-contract-adapter";
import { detectCorrectionLanguage } from "../lib/ai/language-detection";

describe("AI corrections", () => {
  it("builds the locked conservative prompt without style rewrite scope or correction limits", () => {
    const prompt = buildMechanicalCorrectionsPrompt([
      {
        id: "block-1",
        hash: "blk-1",
        text: "El texto tiene un error.",
      },
    ]);

    expect(prompt).toContain("conservative mechanical correction engine");
    expect(prompt).toContain("Do NOT rewrite, polish, translate, or change the author's voice.");
    expect(prompt).toContain("Only include high-confidence corrections.");
    expect(prompt).toContain("Known terms to preserve:");
    expect(prompt).toContain("[block-1]");
    expect(prompt).not.toContain("Max 3");
  });

  it("detects Spanish, English, and mixed language samples", () => {
    expect(detectCorrectionLanguage("Esta carta tiene una frase para mi hermano.")).toBe("es");
    expect(detectCorrectionLanguage("This writing has a sentence for the reader.")).toBe("en");
    expect(detectCorrectionLanguage("Esta carta uses the app and the editor.")).toBe("mixed");
  });

  it("normalizes canonical output and drops corrections whose original text is not in the block", () => {
    const blocks = [
      {
        id: "block-1",
        hash: hashCorrectionBlock("Esta es una prueva."),
        text: "Esta es una prueva.",
      },
      {
        id: "block-2",
        hash: hashCorrectionBlock("React y Next.js aparecen como términos."),
        text: "React y Next.js aparecen como términos.",
      },
    ];
    const canonical = normalizeCanonicalCorrections(
      {
        summary: "One clear correction.",
        language: "unknown",
        corrections: [
          {
            blockId: "block-1",
            type: "spelling",
            severity: "medium",
            confidence: "high",
            originalText: "prueva",
            replacementText: "prueba",
            reason: "Typo.",
          },
          {
            blockId: "block-2",
            type: "spelling",
            severity: "low",
            confidence: "medium",
            originalText: "Pythonn",
            replacementText: "Python",
            reason: "Not present.",
          },
        ],
        uncertain: [
          {
            blockId: "block-2",
            text: "Next.js",
            reason: "Product term.",
            possibleReplacement: null,
          },
        ],
      },
      blocks,
    );

    expect(canonical.language).toBe("es");
    expect(canonical.corrections).toHaveLength(1);
    expect(canonical.corrections[0]?.blockId).toBe("block-1");
    expect(canonical.uncertain).toHaveLength(1);
  });

  it("adapts canonical corrections to legacy publication review shape with block metadata", () => {
    const canonical = normalizeCanonicalCorrections(
      {
        summary: "Ready.",
        language: "en",
        corrections: [
          {
            blockId: "block-1",
            type: "duplication",
            severity: "high",
            confidence: "high",
            originalText: "the the",
            replacementText: "the",
          },
        ],
        uncertain: [
          {
            blockId: "block-1",
            text: "Odessay",
            reason: "Product term.",
            possibleReplacement: null,
          },
        ],
      },
      [{ id: "block-1", hash: "blk-1", text: "Remove the the duplicated word in Odessay." }],
    );

    const legacy = adaptCanonicalCorrectionsToPublicationReview(canonical);

    expect(legacy.suggestions).toMatchObject([
      {
        kind: "spelling",
        block_id: "block-1",
        title: "Remove duplicate",
        original_text: "the the",
        replacement_text: "the",
        status: "pending",
      },
    ]);
    expect(legacy.suggestions[0]?.correction_fingerprint).toContain("block-1|duplication|the the|the");
    expect(legacy.checklist[0]?.target_text).toBe("Odessay");
  });

  it("filters rejected correction memory without removing unrelated corrections", () => {
    const corrections = normalizeCanonicalCorrections(
      {
        summary: "Two corrections.",
        language: "en",
        corrections: [
          {
            blockId: "block-1",
            type: "spelling",
            severity: "medium",
            confidence: "high",
            originalText: "teh",
            replacementText: "the",
            reason: "Typo.",
          },
          {
            blockId: "block-1",
            type: "punctuation",
            severity: "low",
            confidence: "medium",
            originalText: "Hello",
            replacementText: "Hello,",
            reason: "Comma.",
          },
        ],
        uncertain: [],
      },
      [{ id: "block-1", hash: "blk-1", text: "Fix teh word. Hello reader." }],
    ).corrections;

    const filtered = filterCorrectionsByMemory(corrections, {
      entries: [
        {
          fingerprint: createCorrectionFingerprint(corrections[0]!),
          decision: "rejected",
          decidedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.type).toBe("punctuation");
  });
});
