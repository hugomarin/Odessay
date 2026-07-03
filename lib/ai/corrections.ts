import { z } from "zod";
import { detectCorrectionLanguage } from "@/lib/ai/language-detection";
import type { CorrectionLanguage } from "@/lib/ai/language-detection";
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

export const canonicalCorrectionsResponseSchema = z.object({
  summary: z.string().trim().default(""),
  language: z.enum(["es", "en", "mixed", "unknown"]),
  corrections: z.array(canonicalCorrectionSchema).catch([]),
  uncertain: z.array(uncertainCorrectionSchema).catch([]),
});

export type CanonicalCorrection = z.infer<typeof canonicalCorrectionSchema>;
export type CanonicalCorrectionsResponse = z.infer<typeof canonicalCorrectionsResponseSchema>;
export type UncertainCorrection = z.infer<typeof uncertainCorrectionSchema>;

const TOKEN_CHAR_PATTERN = /[\p{L}\p{N}\p{M}'’-]/u;

const isTokenChar = (value: string) => TOKEN_CHAR_PATTERN.test(value);

const hasTokenBoundaryMatch = (source: string, originalText: string) => {
  if (!originalText) {
    return false;
  }

  let searchIndex = 0;

  while (searchIndex <= source.length - originalText.length) {
    const matchIndex = source.indexOf(originalText, searchIndex);

    if (matchIndex === -1) {
      return false;
    }

    const previousChar = matchIndex > 0 ? source[matchIndex - 1] : "";
    const nextChar = source[matchIndex + originalText.length] ?? "";
    const startsAtBoundary = previousChar.length === 0 || !isTokenChar(previousChar);
    const endsAtBoundary = nextChar.length === 0 || !isTokenChar(nextChar);

    if (startsAtBoundary && endsAtBoundary) {
      return true;
    }

    searchIndex = matchIndex + originalText.length;
  }

  return false;
};

const isValidCorrectionMatch = (blockText: string, correction: CanonicalCorrection) => {
  if (!blockText.includes(correction.originalText)) {
    return false;
  }

  return hasTokenBoundaryMatch(blockText, correction.originalText);
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
  const response = canonicalCorrectionsResponseSchema.parse(parsed);
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
