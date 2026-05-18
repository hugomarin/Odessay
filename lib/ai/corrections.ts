import { z } from "zod";
import { detectCorrectionLanguage } from "@/lib/ai/language-detection";
import type { CorrectionLanguage } from "@/lib/ai/language-detection";

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

export const hashCorrectionBlock = (text: string) => {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `blk-${(hash >>> 0).toString(16)}`;
};

export const buildCorrectionBlocks = (text: string): CorrectionBlock[] => {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const sourceBlocks = blocks.length > 0 ? blocks : [text.trim()].filter(Boolean);

  return sourceBlocks.map((block, index) => ({
    id: `block-${index + 1}`,
    text: block,
    hash: hashCorrectionBlock(block),
  }));
};

export const normalizeCanonicalCorrections = (
  parsed: unknown,
  blocks: CorrectionBlock[],
  fallbackLanguage?: CorrectionLanguage,
): CanonicalCorrectionsResponse => {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
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
        return Boolean(block && block.text.includes(correction.originalText));
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

export const buildMechanicalCorrectionsPrompt = (blocks: CorrectionBlock[]) => `
You are a conservative mechanical correction engine.

Detect mechanical errors only: spelling, typos, missing/wrong accents, malformed words, wrong spacing, duplicated words, agreement errors, basic punctuation.
Do NOT rewrite, polish, translate, or change the author's voice.
Do NOT flag technical terms, product names, or regional usage.

Known terms to preserve: AI, Linear, React, Next.js, Python, WhatsApp, CLI, markdown, PDF, app, harness, prompt, writing, collection, desk, settings, topbar, toolbar, export, status, preview.

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
