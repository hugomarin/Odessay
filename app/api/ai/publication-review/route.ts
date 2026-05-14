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

const parseModelJson = (text: string) => {
  const jsonText = extractJsonPayload(text);
  return JSON.parse(jsonText);
};

type PublicationReviewRaw = {
  summary: string | null;
  suggestions: PublicationSuggestion[];
  checklist: PublicationChecklistItem[];
};

const toPublicationReviewRaw = (parsedJson: unknown): PublicationReviewRaw => {
  const parsed = publicationReviewResponseSchema.parse(parsedJson);

  const validSuggestion = (s: { title: string; reason: string; originalText: string; replacementText: string }) =>
    s.title.trim().length > 0 &&
    s.reason.trim().length > 0 &&
    s.originalText.trim().length > 0 &&
    s.replacementText.trim().length > 0;

  const validChecklist = (c: { label: string; detail: string }) =>
    c.label.trim().length > 0 && c.detail.trim().length > 0;

  return {
    summary: parsed.summary || null,
    suggestions: [
      ...toSuggestions("spelling", parsed.spelling.filter(validSuggestion)),
      ...toSuggestions("rewriting", parsed.rewriting.filter(validSuggestion)),
    ],
    checklist: toChecklistItems(parsed.checklist.filter(validChecklist)),
  };
};

async function callPublicationModel({
  config,
  promptText,
  strictJson,
}: {
  config: ReturnType<typeof getAIProviderConfig>;
  promptText: string;
  strictJson: boolean;
}) {
  const response = await fetch(config.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`,
      "user-agent": "Odessay/1.0",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      // Keep temperature low to reduce malformed JSON output.
      temperature: strictJson ? 0 : 0.2,
      top_p: config.topP,
      messages: [
        {
          role: "system",
          content: strictJson
            ? `${buildPublicationReviewSystemPrompt()} Return strictly valid JSON only: no markdown, no prose, no trailing commas.`
            : buildPublicationReviewSystemPrompt(),
        },
        {
          role: "user",
          content: promptText,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    console.log(`[pub-review] error body=${errorPayload.slice(0, 500)}`);
    throw new Error(`AI request failed (${response.status}): ${errorPayload}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = payload.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error("AI returned an empty response.");
  }

  return text;
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

  const firstText = await callPublicationModel({ config, promptText, strictJson: false });
  const t1 = Date.now();
  console.log(`[pub-review] first response latencyMs=${t1 - t0}`);

  try {
    const parsedJson = parseModelJson(firstText);
    const parsed = toPublicationReviewRaw(parsedJson);
    const t2 = Date.now();
    console.log(`[pub-review] first parse ok totalLatencyMs=${t2 - t0}`);
    return { model: config.model, ...parsed };
  } catch (parseErr) {
    const firstJsonText = extractJsonPayload(firstText);
    console.log(`[pub-review] first parse failed. textLength=${firstJsonText.length}`);
    console.log(`[pub-review] first parse raw (first 800): ${firstJsonText.slice(0, 800)}`);
    console.log(`[pub-review] first parse raw (last 800): ${firstJsonText.slice(-800)}`);
    console.log(`[pub-review] retrying with strict JSON mode`);

    const retryText = await callPublicationModel({ config, promptText, strictJson: true });
    const retryJsonText = extractJsonPayload(retryText);

    try {
      const parsedJson = parseModelJson(retryText);
      const parsed = toPublicationReviewRaw(parsedJson);
      const t2 = Date.now();
      console.log(`[pub-review] retry parse ok totalLatencyMs=${t2 - t0}`);
      return { model: config.model, ...parsed };
    } catch (retryErr) {
      console.log(`[pub-review] retry parse failed. textLength=${retryJsonText.length}`);
      console.log(`[pub-review] retry parse raw (first 800): ${retryJsonText.slice(0, 800)}`);
      console.log(`[pub-review] retry parse raw (last 800): ${retryJsonText.slice(-800)}`);
      throw new Error(
        `AI returned invalid JSON: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
    }
  }
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
