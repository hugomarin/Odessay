import { z } from "zod";

const publicationSuggestionSchema = z.object({
  title: z.string().trim().min(1).catch(""),
  reason: z.string().trim().min(1).catch(""),
  originalText: z.string().trim().min(1).catch(""),
  replacementText: z.string().trim().min(1).catch(""),
});

const publicationChecklistItemSchema = z.object({
  label: z.string().trim().min(1).catch(""),
  detail: z.string().trim().min(1).catch(""),
  targetText: z.string().trim().max(120).optional().nullable().catch(null),
});

export const publicationReviewResponseSchema = z.object({
  summary: z.string().trim().optional().default(""),
  spelling: z.array(publicationSuggestionSchema).catch([]),
  rewriting: z.array(publicationSuggestionSchema).catch([]),
  checklist: z.array(publicationChecklistItemSchema).catch([]),
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
    `{summary, spelling:[{title,reason,originalText,replacementText}], rewriting:[...], checklist:[{label,detail,targetText?}]}\n\n` +
    `RULES:\n` +
    `- Max 3 items per category. Empty array if none.\n` +
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
