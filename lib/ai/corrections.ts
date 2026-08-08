import { z } from "zod";
import { detectCorrectionLanguage } from "@/lib/ai/language-detection";
import type { CorrectionLanguage } from "@/lib/ai/language-detection";
import { findTokenBoundaryMatch } from "@/lib/corrections/engine/matching";
import { createLearnedWordSet, normalizeLearnedWord } from "@/lib/corrections/learned-words";

export type CorrectionBlock = {
  id: string;
  text: string;
  hash: string;
};

export const correctionTypeSchema = z.enum([
  "spelling",
  "accent",
  "grammar",
  "agreement",
  "punctuation",
  "duplication",
  "spacing",
  "basic_redaction",
]);

export const canonicalCorrectionSchema = z.object({
  blockId: z.string().trim().min(1),
  type: correctionTypeSchema,
  severity: z.enum(["low", "medium", "high"]).optional().default("low"),
  confidence: z.enum(["high", "medium"]).optional().default("medium"),
  originalText: z.string().trim().min(1),
  replacementText: z.string().trim().min(1),
});

export const uncertainCorrectionSchema = z.object({
  blockId: z.string().trim().min(1),
  text: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  possibleReplacement: z.string().trim().min(1).nullable().catch(null),
});

const rawCanonicalCorrectionsResponseSchema = z.object({
  summary: z.string().trim().default(""),
  language: z.enum(["es", "en", "mixed", "unknown"]),
  corrections: z.array(z.unknown()).catch([]),
  uncertain: z.array(z.unknown()).catch([]),
});

export type CanonicalCorrection = z.infer<typeof canonicalCorrectionSchema>;
export type UncertainCorrection = z.infer<typeof uncertainCorrectionSchema>;
export type CanonicalCorrectionsResponse = {
  summary: string;
  language: "es" | "en" | "mixed" | "unknown";
  corrections: CanonicalCorrection[];
  uncertain: UncertainCorrection[];
};

const isValidCorrectionMatch = (blockText: string, correction: CanonicalCorrection) => {
  return findTokenBoundaryMatch(blockText, correction.originalText, correction.replacementText) !== null;
};

const parseItems = <T>(
  items: unknown[],
  schema: z.ZodType<T>,
  logMessage: string,
) => {
  const parsedItems: T[] = [];
  let dropped = 0;

  for (const item of items) {
    const parsed = schema.safeParse(item);

    if (parsed.success) {
      parsedItems.push(parsed.data);
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    console.info(logMessage, { dropped });
  }

  return parsedItems;
};

export const hashCorrectionBlock = (text: string) => {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `blk-${(hash >>> 0).toString(16)}`;
};

export const normalizeCanonicalCorrections = (
  parsed: unknown,
  blocks: CorrectionBlock[],
  fallbackLanguage?: CorrectionLanguage,
  learnedWords: Iterable<string> = [],
): CanonicalCorrectionsResponse => {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const learnedWordSet = createLearnedWordSet(learnedWords);
  const rawResponse = rawCanonicalCorrectionsResponseSchema.parse(parsed);
  const response: CanonicalCorrectionsResponse = {
    summary: rawResponse.summary,
    language: rawResponse.language,
    corrections: parseItems(
      rawResponse.corrections,
      canonicalCorrectionSchema,
      "[corrections] dropped invalid correction items",
    ),
    uncertain: parseItems(
      rawResponse.uncertain,
      uncertainCorrectionSchema,
      "[corrections] dropped invalid uncertain items",
    ),
  };
  const language = response.language === "unknown"
    ? fallbackLanguage ?? detectCorrectionLanguage(blocks.map((block) => block.text).join("\n\n"))
    : response.language;

  const singleBlock = blocks.length === 1 ? blocks[0] : null;

  return {
    ...response,
    language,
    corrections: response.corrections
      .map((correction) => {
        if (blockById.has(correction.blockId)) return correction;
        if (singleBlock) return { ...correction, blockId: singleBlock.id };
        return correction;
      })
      .filter((correction) => {
        const block = blockById.get(correction.blockId);
        return Boolean(
          block &&
          isValidCorrectionMatch(block.text, correction) &&
          !learnedWordSet.has(normalizeLearnedWord(correction.originalText)) &&
          correction.originalText.trim() !== correction.replacementText.trim(),
        );
      }),
    uncertain: response.uncertain
      .map((item) => {
        if (blockById.has(item.blockId)) return item;
        if (singleBlock) return { ...item, blockId: singleBlock.id };
        return item;
      })
      .filter((item) => blockById.has(item.blockId)),
  };
};

export const buildMechanicalCorrectionsPrompt = (
  blocks: CorrectionBlock[],
  learnedWords: string[] = [],
) => `
You are a conservative mechanical correction engine.

Detect mechanical errors only: spelling, typos, missing/wrong accents, malformed words, wrong spacing, duplicated words, agreement errors, basic punctuation.
Do NOT rewrite, polish, translate, or change the author's voice.
Do NOT flag technical terms, product names, or regional usage.
Do NOT flag English words in mixed-language (Spanish/English) documents — treat them as intentional.
Do NOT suggest a correction where originalText and replacementText are identical.
Do NOT flag any item that appears in the user's learned words list.

Known terms to preserve: AI, Linear, React, Next.js, Python, WhatsApp, CLI, markdown, PDF, app, harness, harnesses, prompt, writing, collection, desk, settings, topbar, toolbar, export, status, preview, artifact, artifacts, compaction, skill, skills, workflow, loop, review, reviewer, performance, multiagent, memory.

User learned words to always preserve:
${learnedWords.length > 0 ? learnedWords.join(", ") : "(none)"}

Return valid JSON:
{
  "language": "es" | "en" | "mixed" | "unknown",
  "corrections": [
    {
      "blockId": string,
      "type": "spelling" | "accent" | "grammar" | "agreement" | "punctuation" | "duplication" | "spacing" | "basic_redaction",
      "originalText": string,
      "replacementText": string
    }
  ]
}

Rules:
- originalText must appear exactly in the block.
- Use the smallest possible replacement (prefer word-level).
- Only include high-confidence corrections.
- Skip anything stylistic.
- No markdown, no comments outside JSON.

Blocks:
${blocks.map((block) => `[${block.id}]\n${block.text}`).join("\n\n")}
`;

/**
 * Build a temporary id mapping so the model receives simple, copy-pasteable
 * block ids while the internal pipeline keeps stable `correction-block:*` ids.
 * This prevents the model from “summarizing” long block ids into partial ids
 * like "0.0" and losing the association with the original block.
 */
export function buildModelReadyCorrectionBlocks(blocks: CorrectionBlock[]): {
  modelBlocks: CorrectionBlock[];
  idMap: Map<string, string>;
} {
  const idMap = new Map<string, string>();
  const modelBlocks = blocks.map((block, index) => {
    const modelId = `block-${index}`;
    idMap.set(modelId, block.id);
    return { ...block, id: modelId };
  });
  return { modelBlocks, idMap };
}

/**
 * Restore original block ids on corrections returned by the model.
 */
export function restoreRealCorrectionBlockIds<T extends { blockId: string }>(
  items: T[],
  idMap: Map<string, string>,
): T[] {
  return items.map((item) => ({
    ...item,
    blockId: idMap.get(item.blockId) ?? item.blockId,
  }));
}
