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
  severity: z.enum(["low", "medium", "high"]),
  confidence: z.enum(["high", "medium"]),
  originalText: z.string().trim().min(1),
  replacementText: z.string().trim().min(1),
  reason: z.string().trim().min(1),
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

  return {
    ...response,
    language,
    corrections: response.corrections.filter((correction) => {
      const block = blockById.get(correction.blockId);
      return Boolean(block && block.text.includes(correction.originalText));
    }),
    uncertain: response.uncertain.filter((item) => blockById.has(item.blockId)),
  };
};

export const buildMechanicalCorrectionsPrompt = (blocks: CorrectionBlock[]) => `
You are Odessay's conservative mechanical correction engine.

Analyze the text block by block. Each block has a blockId.
Return corrections linked to blockId.

Your task is to detect mechanical writing issues only:
- spelling mistakes
- typos
- missing or incorrect accents
- malformed words
- wrong spacing inside words
- duplicated words or duplicated phrases
- gender agreement
- number agreement
- article/noun agreement
- verb agreement
- basic punctuation
- basic sentence boundary issues
- minimally repairing clearly broken phrases

This is NOT a rewriting task.
This is NOT a style-improvement task.
This is NOT a translation task.

Core rule:
Correct mechanical issues with high confidence.
Do not rewrite the author's voice.
When uncertain, report uncertainty instead of correcting.

Classification step (internal):
For each suspicious fragment, classify mentally as:
1. clear error
2. product/technical term
3. uncertain

Only return corrections for clear errors.
Return uncertain cases separately.

Do NOT:
- rewrite the author's voice
- polish prose
- make the text more formal
- make the text sound corporate, literary, generic, or AI-generated
- change the author's intention
- translate
- normalize technical/product terms
- change regional Spanish usage unless objectively incorrect
- suggest broad style improvements
- include style-only suggestions

Known terms to preserve unless clearly misspelled:
AI, Linear, React, Next, Next.js, Python, WhatsApp, CLI, markdown, PDF, Docs, app, App Store, harness, prompt, writing, writings, collection, collections, desk, settings, topbar, toolbar, export, status, preview.

Return only valid JSON with this exact shape:
{
  "summary": string,
  "language": "es" | "en" | "mixed" | "unknown",
  "corrections": [
    {
      "blockId": string,
      "type": "spelling" | "accent" | "grammar" | "agreement" | "punctuation" | "duplication" | "spacing" | "basic_redaction",
      "severity": "low" | "medium" | "high",
      "confidence": "high" | "medium",
      "originalText": string,
      "replacementText": string,
      "reason": string
    }
  ],
  "uncertain": [
    {
      "blockId": string,
      "text": string,
      "reason": string,
      "possibleReplacement": string | null
    }
  ]
}

Rules:
- Scan every block.
- Include every clear correction.
- Do not limit the number of corrections.
- originalText must appear exactly inside the corresponding block.
- Use the smallest possible replacement.
- Prefer replacements of 1-8 words.
- replacementText must be minimally different and similar in length to originalText.
- Prefer word-level or short-phrase corrections.
- Use sentence-level replacement only when the phrase is clearly broken or ungrammatical.
- Never include low-confidence corrections.
- If a suggestion improves style but not correctness, discard it.
- Put ambiguous product/technical terms in "uncertain".
- Preserve meaning, tone, and terminology.
- No markdown.
- No comments outside JSON.

Blocks:
${blocks.map((block) => `[${block.id}]\n${block.text}`).join("\n\n")}
`;
