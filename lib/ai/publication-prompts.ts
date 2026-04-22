import { z } from "zod";

export const PUBLICATION_PRIMARY_MODEL = "claude-opus-4-1-20250805";
export const PUBLICATION_FALLBACK_MODEL = "claude-sonnet-4-20250514";
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
  summary: z.string().trim().max(280).optional().default(""),
  spelling: z.array(publicationSuggestionSchema).max(12).default([]),
  rewriting: z.array(publicationSuggestionSchema).max(12).default([]),
  checklist: z.array(publicationChecklistItemSchema).max(10).default([]),
});

type BuildPublicationPromptArgs = {
  title: string;
  markdown: string;
  bodyText: string;
};

export const buildPublicationReviewSystemPrompt = () => `
You are an editorial publication reviewer for literary writing.

Return JSON only. Do not wrap the JSON in markdown code fences.
Be conservative:
- preserve the author's voice;
- avoid large rewrites;
- only propose concrete edits that can be applied individually;
- each originalText must be copied verbatim from the provided markdown;
- each replacementText must be a direct replacement for originalText;
- checklist items must be actionable and tied to an existing text location when possible.

Sections:
- spelling: orthography and grammar corrections only;
- rewriting: clarity, redundancy, flow, or tone improvements;
- checklist: publish-readiness observations that do not directly rewrite text.
`.trim();

export const buildPublicationReviewUserPrompt = ({
  title,
  markdown,
  bodyText,
}: BuildPublicationPromptArgs) => `
Review this Odessay writing for publication readiness.

Title: ${title || "Untitled writing"}
Approximate word count: ${bodyText.trim().split(/\s+/).filter(Boolean).length}

Return JSON with this exact shape:
{
  "summary": "short summary",
  "spelling": [
    {
      "title": "short label",
      "reason": "why this correction matters",
      "originalText": "exact snippet from markdown",
      "replacementText": "replacement snippet",
      "contextBefore": "optional short context",
      "contextAfter": "optional short context"
    }
  ],
  "rewriting": [
    {
      "title": "short label",
      "reason": "why this improves the passage",
      "originalText": "exact snippet from markdown",
      "replacementText": "replacement snippet",
      "contextBefore": "optional short context",
      "contextAfter": "optional short context"
    }
  ],
  "checklist": [
    {
      "label": "short checklist label",
      "detail": "actionable explanation",
      "targetText": "optional exact snippet to jump to"
    }
  ]
}

Rules:
- Prefer 3-8 spelling items, 3-8 rewriting items, and 3-6 checklist items when useful.
- If a category has nothing useful, return an empty array.
- Do not suggest a full rewrite of the whole text.
- Do not invent context that is not present in the markdown.
- Keep replacementText close in length to originalText unless brevity is the point.

Markdown to review:
"""markdown
${markdown}
"""
`.trim();
