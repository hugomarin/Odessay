import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ANTHROPIC_API_VERSION,
  PUBLICATION_FALLBACK_MODEL,
  PUBLICATION_PRIMARY_MODEL,
  buildPublicationReviewSystemPrompt,
  buildPublicationReviewUserPrompt,
  publicationReviewResponseSchema,
} from "@/lib/ai/publication-prompts";
import type { PublicationChecklistItem, PublicationSuggestion } from "@/lib/local-db/schema";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  writingId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(160).default("Untitled writing"),
  markdown: z.string().trim().min(1),
  bodyText: z.string().default(""),
  sourceHash: z.string().trim().min(1),
});

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json(
    {
      data: null,
      error: {
        code,
        message,
      },
    },
    { status },
  );

const parseAnthropicText = (payload: unknown) => {
  const content = Array.isArray((payload as { content?: unknown })?.content)
    ? (payload as { content: Array<{ type?: string; text?: string }> }).content
    : [];

  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
};

const extractJsonPayload = (value: string) => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return value;
  }

  return value.slice(firstBrace, lastBrace + 1);
};

const toSuggestions = (
  kind: PublicationSuggestion["kind"],
  items: Array<z.infer<typeof publicationReviewResponseSchema>["spelling"][number]>,
): PublicationSuggestion[] =>
  items.map((item, index) => ({
    id: `${kind}-${index + 1}`,
    kind,
    title: item.title,
    reason: item.reason,
    original_text: item.originalText,
    replacement_text: item.replacementText,
    context_before: item.contextBefore ?? null,
    context_after: item.contextAfter ?? null,
    status: "pending",
  }));

const toChecklistItems = (
  items: Array<z.infer<typeof publicationReviewResponseSchema>["checklist"][number]>,
): PublicationChecklistItem[] =>
  items.map((item, index) => ({
    id: `checklist-${index + 1}`,
    label: item.label,
    detail: item.detail,
    target_text: item.targetText ?? null,
    status: "pending",
  }));

async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { userId: user?.id ?? null };
}

async function requestPublicationReview(model: string, requestBody: z.infer<typeof requestSchema>) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2200,
      temperature: 0.2,
      system: buildPublicationReviewSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildPublicationReviewUserPrompt({
            title: requestBody.title,
            markdown: requestBody.markdown,
            bodyText: requestBody.bodyText,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${errorPayload}`);
  }

  const payload = await response.json();
  const text = parseAnthropicText(payload);

  if (!text) {
    throw new Error("Anthropic returned an empty response.");
  }

  const parsed = publicationReviewResponseSchema.parse(JSON.parse(extractJsonPayload(text)));

  return {
    model,
    summary: parsed.summary || null,
    suggestions: [...toSuggestions("spelling", parsed.spelling), ...toSuggestions("rewriting", parsed.rewriting)],
    checklist: toChecklistItems(parsed.checklist),
  };
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUserId();

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(500, "MISSING_CONFIG", "ANTHROPIC_API_KEY is not configured.");
  }

  const rawBody = await request.json();
  const parsedRequest = requestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return jsonError(400, "INVALID_INPUT", parsedRequest.error.message);
  }

  try {
    const primaryResult = await requestPublicationReview(PUBLICATION_PRIMARY_MODEL, parsedRequest.data);

    return NextResponse.json(
      {
        data: {
          sourceHash: parsedRequest.data.sourceHash,
          sourceMarkdown: parsedRequest.data.markdown,
          model: primaryResult.model,
          suggestions: primaryResult.suggestions,
          checklist: primaryResult.checklist,
          summary: primaryResult.summary,
          fallbackUsed: false,
        },
        error: null,
      },
      { status: 200 },
    );
  } catch (primaryError) {
    try {
      const fallbackResult = await requestPublicationReview(PUBLICATION_FALLBACK_MODEL, parsedRequest.data);

      return NextResponse.json(
        {
          data: {
            sourceHash: parsedRequest.data.sourceHash,
            sourceMarkdown: parsedRequest.data.markdown,
            model: fallbackResult.model,
            suggestions: fallbackResult.suggestions,
            checklist: fallbackResult.checklist,
            summary: fallbackResult.summary,
            fallbackUsed: true,
          },
          error: null,
        },
        { status: 200 },
      );
    } catch (fallbackError) {
      const message =
        fallbackError instanceof Error
          ? fallbackError.message
          : primaryError instanceof Error
            ? primaryError.message
            : "Publication review request failed.";

      return jsonError(502, "AI_REVIEW_FAILED", message);
    }
  }
}
