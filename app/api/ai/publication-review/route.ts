export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildPublicationReviewSystemPrompt,
  buildPublicationReviewUserPrompt,
  publicationReviewResponseSchema,
} from "@/lib/ai/publication-prompts";
import { getAIProviderConfig } from "@/lib/ai/provider-config";
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
    context_before: null,
    context_after: null,
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

async function requestPublicationReview(requestBody: z.infer<typeof requestSchema>) {
  const t0 = Date.now();
  const config = getAIProviderConfig();

  const promptText = buildPublicationReviewUserPrompt({
    title: requestBody.title,
    markdown: requestBody.markdown,
    bodyText: requestBody.bodyText,
  });

  console.log(`[pub-review] start provider=${config.baseUrl} model=${config.model} promptChars=${promptText.length}`);

  const response = await fetch(config.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`,
      "user-agent": "Odessay/1.0",
    },
    body: JSON.stringify({
      model: config.model,
      max_completion_tokens: config.maxCompletionTokens,
      temperature: config.temperature,
      top_p: config.topP,
      messages: [
        {
          role: "system",
          content: buildPublicationReviewSystemPrompt(),
        },
        {
          role: "user",
          content: promptText,
        },
      ],
    }),
  });

  const t1 = Date.now();
  console.log(`[pub-review] response status=${response.status} latencyMs=${t1 - t0}`);

  if (!response.ok) {
    const errorPayload = await response.text();
    console.log(`[pub-review] error body=${errorPayload.slice(0, 500)}`);
    throw new Error(`AI request failed (${response.status}): ${errorPayload}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const t2 = Date.now();
  console.log(`[pub-review] json parsed parseLatencyMs=${t2 - t1}`);

  const text = payload.choices?.[0]?.message?.content ?? "";

  if (!text) {
    throw new Error("AI returned an empty response.");
  }

  const jsonText = extractJsonPayload(text);
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(jsonText);
  } catch (parseErr) {
    console.log(`[pub-review] JSON parse failed. Raw text length=${jsonText.length}`);
    console.log(`[pub-review] JSON raw text (first 800 chars): ${jsonText.slice(0, 800)}`);
    console.log(`[pub-review] JSON raw text (last 800 chars): ${jsonText.slice(-800)}`);
    throw new Error(`AI returned invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
  }

  const parsed = publicationReviewResponseSchema.parse(parsedJson);
  const t3 = Date.now();
  console.log(`[pub-review] schema validated totalLatencyMs=${t3 - t0}`);

  return {
    model: config.model,
    summary: parsed.summary || null,
    suggestions: [...toSuggestions("spelling", parsed.spelling), ...toSuggestions("rewriting", parsed.rewriting)],
    checklist: toChecklistItems(parsed.checklist),
  };
}

export async function POST(request: Request) {
  const tStart = Date.now();
  console.log(`[pub-review] POST start`);

  const { userId } = await getCurrentUserId();
  const tAuth = Date.now();
  console.log(`[pub-review] auth done authMs=${tAuth - tStart}`);

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.");
  }

  try {
    getAIProviderConfig();
  } catch (configErr) {
    const message = configErr instanceof Error ? configErr.message : "AI provider not configured.";
    return jsonError(500, "MISSING_CONFIG", message);
  }

  const rawBody = await request.json();
  const parsedRequest = requestSchema.safeParse(rawBody);

  if (!parsedRequest.success) {
    return jsonError(400, "INVALID_INPUT", parsedRequest.error.message);
  }

  try {
    const result = await requestPublicationReview(parsedRequest.data);
    const tEnd = Date.now();
    console.log(`[pub-review] success totalRouteMs=${tEnd - tStart}`);

    return NextResponse.json(
      {
        data: {
          sourceHash: parsedRequest.data.sourceHash,
          sourceMarkdown: parsedRequest.data.markdown,
          model: result.model,
          suggestions: result.suggestions,
          checklist: result.checklist,
          summary: result.summary,
          fallbackUsed: false,
        },
        error: null,
      },
      { status: 200 },
    );
  } catch (error) {
    const tEnd = Date.now();
    const message = error instanceof Error ? error.message : "Publication review request failed.";
    console.log(`[pub-review] error totalRouteMs=${tEnd - tStart} message=${message}`);

    return jsonError(502, "AI_REVIEW_FAILED", message);
  }
}
