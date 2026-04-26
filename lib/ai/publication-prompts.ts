import { z } from "zod";

export const PUBLICATION_PRIMARY_MODEL = "claude-haiku-4-5";
export const PUBLICATION_FALLBACK_MODEL = "claude-sonnet-4-6";
export const ANTHROPIC_API_VERSION = "2023-06-01";

const publicationSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(220),
  originalText: z.string().trim().min(1).max(600),
  replacementText: z.string().trim().min(1).max(600),
  contextBefore: z.string().trim().max(120).optional().nullable(),
  contextAfter: z.string().trim().max(120).optional().nullable(),
});

const publicationChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(100),
  detail: z.string().trim().min(1).max(220),
  targetText: z.string().trim().max(240).optional().nullable(),
});

export const publicationReviewResponseSchema = z.object({
  summary: z.string().trim().optional().default(""),
  spelling: z.array(publicationSuggestionSchema).max(8).default([]),
  rewriting: z.array(publicationSuggestionSchema).max(6).default([]),
  checklist: z.array(publicationChecklistItemSchema).max(5).default([]),
});

type BuildPublicationPromptArgs = {
  title: string;
  markdown: string;
  bodyText: string;
};

export const buildPublicationReviewSystemPrompt = () =>
  `You are a concise publication reviewer. Return only JSON (no markdown fences). ` +
  `Be conservative: preserve voice, avoid full rewrites, propose only concrete edits. ` +
  `originalText must be verbatim from the text; replacementText must be a direct replacement. ` +
  `Sections: spelling (orthography/grammar), rewriting (clarity/flow), checklist (publish-readiness observations).`;

export const buildPublicationReviewUserPrompt = ({
  title,
  markdown,
  bodyText,
}: BuildPublicationPromptArgs) => {
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  return (
    `Review for publication readiness. ` +
    `Return JSON: {summary, spelling[{title,reason,originalText,replacementText,contextBefore?,contextAfter?}], ` +
    `rewriting[{title,reason,originalText,replacementText,contextBefore?,contextAfter?}], ` +
    `checklist[{label,detail,targetText?}]}. ` +
    `Max 5 spelling, 5 rewriting, 3 checklist. Use empty arrays if none. ` +
    `Keep fields concise. Do not invent context.\n\n` +
    `Title: ${title || "Untitled"}\n` +
    `Words: ${wordCount}\n\n` +
    `${markdown}`
  );
};
