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
import { logAiAdmissionEvent, releaseAiAdmission, tryAcquireAiAdmission } from "@/lib/ai/admission";

const requestSchema = z.object({
  currentTitle: z.string().trim().max(160).default("Untitled artifact"),
  bodyText: z.string().max(50000).default(""),
});

// ODE-524: this route had no timeout at all — an unresponsive provider could
// hold an admitted concurrency slot open indefinitely.
const PROVIDER_REQUEST_TIMEOUT_MS = 45_000;

const jsonError = (status: number, code: string, message: string, headers?: HeadersInit) =>
  NextResponse.json(
    {
      data: null,
      error: {
        code,
        message,
      },
    },
    { status, headers },
  );

async function requestTitleSuggestion(requestBody: z.infer<typeof requestSchema>) {
  const config = getAIProviderConfig();
  const promptText = buildTitleSuggestionUserPrompt({
    currentTitle: requestBody.currentTitle,
    bodyText: requestBody.bodyText,
  });

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), PROVIDER_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(config.chatCompletionsUrl, {
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
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

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

  const admission = await tryAcquireAiAdmission({ accountId: userId, routeKey: "title-suggestions" });
  if (!admission.admitted) {
    return withCorsHeaders(
      jsonError(
        429,
        admission.reason === "rate_limited" ? "RATE_LIMITED" : "CONCURRENCY_LIMITED",
        "Too many AI requests right now. Try again shortly.",
        { "Retry-After": String(admission.retryAfterSeconds) },
      ),
      request,
    );
  }

  try {
    const suggestion = await requestTitleSuggestion(parsed.data);
    return withCorsHeaders(NextResponse.json({
      data: suggestion,
      error: null,
    }), request);
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    logAiAdmissionEvent({ event: isAbort ? "timeout" : "provider_error", routeKey: "title-suggestions" });
    console.error("[title-suggestions]", error);
    return withCorsHeaders(
      jsonError(
        isAbort ? 504 : 502,
        "AI_REQUEST_FAILED",
        isAbort ? "Title suggestion timed out." : "Could not suggest a name right now.",
      ),
      request,
    );
  } finally {
    await releaseAiAdmission(admission.leaseId);
  }
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
