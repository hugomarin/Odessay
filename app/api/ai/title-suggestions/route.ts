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
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth";
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors";

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
      "user-agent": "ArtifactStudio/1.0",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      temperature: 0.4,
      top_p: config.topP,
      response_format: { type: "json_object" },
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
    throw new Error(`Fireworks ${response.status} — model=${config.model} — ${errorPayload}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(extractTitleSuggestionJson(content));
  } catch {
    throw new Error(`Model returned non-JSON content: ${content.slice(0, 200)}`);
  }

  const parsed = titleSuggestionResponseSchema.safeParse(parsedJson);

  if (!parsed.success) {
    throw new Error(`AI title response did not match schema. Content: ${content.slice(0, 200)}`);
  }

  return parsed.data;
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request);

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "Sign in to suggest a title."), request);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Could not read the title suggestion request."), request);
  }

  if (!hasEnoughTitleSuggestionContent(parsed.data.bodyText)) {
    return withCorsHeaders(jsonError(422, "INVALID_INPUT", "Write a little more before asking AI for a title."), request);
  }

  try {
    const suggestion = await requestTitleSuggestion(parsed.data);
    return withCorsHeaders(NextResponse.json({
      data: suggestion,
      error: null,
    }), request);
  } catch (error) {
    console.error("[title-suggestions]", error);
    return withCorsHeaders(jsonError(502, "AI_REQUEST_FAILED", "Could not suggest a title right now."), request);
  }
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
