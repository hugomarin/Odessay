import { z } from "zod";

const publicationSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(60),
  reason: z.string().trim().min(1).max(80),
  originalText: z.string().trim().min(1).max(200),
  replacementText: z.string().trim().min(1).max(200),
});

const publicationChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(60),
  detail: z.string().trim().min(1).max(100),
  targetText: z.string().trim().max(120).optional().nullable(),
});

export const publicationReviewResponseSchema = z.object({
  summary: z.string().trim().optional().default(""),
  spelling: z.array(publicationSuggestionSchema).max(3).default([]),
  rewriting: z.array(publicationSuggestionSchema).max(3).default([]),
  checklist: z.array(publicationChecklistItemSchema).max(3).default([]),
});

type BuildPublicationPromptArgs = {
  title: string;
  markdown: string;
  bodyText: string;
};

export const buildPublicationReviewSystemPrompt = () =>
  `You are a concise publication reviewer. Return only JSON. ` +
  `Be conservative: preserve voice, avoid full rewrites, propose only concrete edits.`;

export const buildPublicationReviewUserPrompt = ({
  title,
  markdown,
  bodyText,
}: BuildPublicationPromptArgs) => {
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  return (
    `Review for publication readiness. Return compact JSON:\n` +
    `{summary, spelling[{title,reason,originalText,replacementText}], rewriting[...], checklist[{label,detail,targetText?}]}\n\n` +
    `STRICT LIMITS:\n` +
    `- Maximum 3 items per category (spelling, rewriting, checklist). Empty array if none.\n` +
    `- title: 2-4 words\n` +
    `- reason: 3-6 words only\n` +
    `- originalText and replacementText: short snippets\n` +
    `- detail: 3-8 words only\n` +
    `- summary: 1 short sentence\n` +
    `- Do not invent context\n\n` +
    `Title: ${title || "Untitled"} | Words: ${wordCount}\n\n` +
    `${markdown}`
  );
};
