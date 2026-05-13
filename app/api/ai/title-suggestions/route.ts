export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAIProviderConfig } from "@/lib/ai/provider-config";
import {
  buildTitleSuggestionSystemPrompt,
  buildTitleSuggestionUserPrompt,
  extractTitleSuggestionJson,
  hasEnoughTitleSuggestionContent,
  titleSuggestionResponseSchema,
} from "@/lib/ai/title-suggestions";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  currentTitle: z.string().trim().max(160).default("Untitled writing"),
  bodyText: z.string().max(50000).default(""),
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

async function getCurrentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { userId: user?.id ?? null };
}

async function requestTitleSuggestion(requestBody: z.infer<typeof requestSchema>) {
  const config = getAIProviderConfig();
  const promptText = buildTitleSuggestionUserPrompt({
    currentTitle: requestBody.currentTitle,
    bodyText: requestBody.bodyText,
  });

  const response = await fetch(config.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`,
      "user-agent": "Odessay/1.0",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: Math.min(config.maxTokens, 120),
      temperature: 0.4,
      top_p: config.topP,
      messages: [
        {
          role: "system",
          content: buildTitleSuggestionSystemPrompt(),
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
    throw new Error(`AI request failed (${response.status}): ${errorPayload}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const parsed = titleSuggestionResponseSchema.safeParse(JSON.parse(extractTitleSuggestionJson(content)));

  if (!parsed.success) {
    throw new Error("AI title response did not match the expected schema.");
  }

  return parsed.data;
}

export async function POST(request: Request) {
  const { userId } = await getCurrentUserId();

  if (!userId) {
    return jsonError(401, "unauthorized", "Sign in to suggest a title.");
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(400, "invalid_request", "Could not read the title suggestion request.");
  }

  if (!hasEnoughTitleSuggestionContent(parsed.data.bodyText)) {
    return jsonError(422, "insufficient_content", "Write a little more before asking AI for a title.");
  }

  try {
    const suggestion = await requestTitleSuggestion(parsed.data);
    return NextResponse.json({
      data: suggestion,
      error: null,
    });
  } catch (error) {
    console.error("[title-suggestions]", error);
    return jsonError(502, "ai_request_failed", "Could not suggest a title right now.");
  }
}
