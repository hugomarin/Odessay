// class: detail (bounded grounded Q&A; always returns an answer plus optional evidence and read requests)
export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"
import {
  buildWorkspaceAskSystemPrompt,
  buildWorkspaceAskUserPrompt,
  sanitizeWorkspaceAskPayload,
  workspaceAskRequestSchema,
  workspaceAskTextFormat,
  workspaceAskResponseSchema,
  type WorkspaceAskApiPayload,
} from "@/lib/ai/workspace-ask"
import { getOpenAIWorkspaceProviderConfig } from "@/lib/ai/openai-workspace-provider-config"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

type AskUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

type AskRouteErrorDetails = {
  providerStatus?: number
  providerBodyClass?: string
  phase?: "provider" | "parse" | "config"
}

class AskRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details: AskRouteErrorDetails = {},
  ) {
    super(message)
    this.name = "AskRouteError"
  }
}

const PROVIDER_REQUEST_TIMEOUT_MS = 45_000

function classifyProviderBody(body: string): string {
  const normalized = body.toLocaleLowerCase()
  if (!body.trim()) return "empty"
  if (normalized.includes("rate") || normalized.includes("quota")) return "rate_limit"
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout"
  if (normalized.includes("schema") || normalized.includes("response_format")) return "structured_output_contract"
  if (normalized.includes("context") || normalized.includes("token")) return "token_budget_or_context"
  if (normalized.includes("invalid") || normalized.includes("bad request")) return "provider_contract"
  return "provider_error"
}

const jsonError = (
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: AskRouteErrorDetails } = {},
) =>
  NextResponse.json(
    {
      data: null,
      error: {
        code,
        message,
        retryable: options.retryable ?? (status >= 500 || status === 429),
        ...(options.details ? { details: options.details } : {}),
      },
    },
    { status },
  )

function extractJsonPayload(value: string): string {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) return fencedMatch[1].trim()

  const firstBrace = value.indexOf("{")
  const lastBrace = value.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return value
  return value.slice(firstBrace, lastBrace + 1)
}

async function callAskModel({
  config,
  promptText,
}: {
  config: ReturnType<typeof getOpenAIWorkspaceProviderConfig>
  promptText: string
}): Promise<{ text: string; usage: AskUsage }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(config.responsesUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${config.apiKey}`,
        "user-agent": "Odessay/1.0",
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          { role: "system", content: buildWorkspaceAskSystemPrompt() },
          { role: "user", content: promptText },
        ],
        max_output_tokens: Math.max(config.maxOutputTokens, 8_192),
        reasoning: { effort: config.reasoningEffort },
        store: false,
        text: { format: workspaceAskTextFormat },
      }),
      signal: controller.signal,
    })
  } catch (cause) {
    const isAbort = cause instanceof Error && cause.name === "AbortError"
    throw new AskRouteError(
      isAbort ? 504 : 503,
      isAbort ? "TIMEOUT" : "UNAVAILABLE",
      isAbort
        ? "AI provider timed out while answering the question."
        : "AI provider is unavailable for the Workspace agent.",
      true,
      { phase: "provider" },
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const providerBodyClass = classifyProviderBody(await response.text())
    console.info("[workspace-ask] provider error", {
      status: response.status,
      bodyClass: providerBodyClass,
    })

    if (response.status === 429) {
      throw new AskRouteError(
        429,
        "RATE_LIMITED",
        "AI provider rate limited the Workspace agent.",
        true,
        { phase: "provider", providerStatus: response.status, providerBodyClass },
      )
    }

    if (response.status === 400 || response.status === 422) {
      throw new AskRouteError(
        422,
        "AI_PROVIDER_CONTRACT_ERROR",
        "AI provider rejected the Workspace agent contract.",
        false,
        { phase: "provider", providerStatus: response.status, providerBodyClass },
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new AskRouteError(
        502,
        "AI_PROVIDER_AUTH_ERROR",
        "OpenAI rejected the configured Workspace agent credentials.",
        false,
        { phase: "provider", providerStatus: response.status, providerBodyClass },
      )
    }

    throw new AskRouteError(
      response.status >= 500 ? 503 : 502,
      response.status >= 500 ? "UNAVAILABLE" : "AI_PROVIDER_ERROR",
      response.status >= 500
        ? "AI provider is unavailable for the Workspace agent."
        : "AI provider failed to answer the question.",
      response.status >= 500,
      { phase: "provider", providerStatus: response.status, providerBodyClass },
    )
  }

  let payload: {
    output_text?: string
    status?: string
    incomplete_details?: { reason?: string | null } | null
    output?: Array<{
      type?: string
      content?: Array<{
        type?: string
        text?: string
        refusal?: string
      }>
    }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
  }

  try {
    payload = await response.json()
  } catch {
    throw new AskRouteError(
      502,
      "AI_RESPONSE_PARSE_FAILED",
      "AI provider returned an invalid Workspace agent response.",
      true,
      { phase: "parse", providerStatus: response.status },
    )
  }

  if (payload.status === "incomplete") {
    throw new AskRouteError(
      502,
      "AI_RESPONSE_PARSE_FAILED",
      "AI provider truncated the Workspace agent response.",
      true,
      { phase: "parse", providerStatus: response.status },
    )
  }

  const refusal = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "refusal")

  if (refusal) {
    throw new AskRouteError(
      502,
      "AI_RESPONSE_REFUSED",
      "OpenAI refused to answer the question.",
      false,
      { phase: "parse", providerStatus: response.status },
    )
  }

  const outputText = payload.output_text
    ?? payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("")
  const text = outputText?.trim() ?? ""
  if (!text) {
    throw new AskRouteError(
      502,
      "AI_RESPONSE_PARSE_FAILED",
      "AI provider returned an empty Workspace agent response.",
      true,
      { phase: "parse", providerStatus: response.status },
    )
  }

  return {
    text,
    usage: {
      promptTokens: payload.usage?.input_tokens ?? null,
      completionTokens: payload.usage?.output_tokens ?? null,
      totalTokens: payload.usage?.total_tokens ?? null,
    },
  }
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "Sign in to use the Workspace agent."), request)
  }

  const parsed = workspaceAskRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Could not read the Workspace agent request."), request)
  }

  const startedAt = Date.now()
  try {
    let config: ReturnType<typeof getOpenAIWorkspaceProviderConfig>
    try {
      config = getOpenAIWorkspaceProviderConfig()
    } catch (cause) {
      throw new AskRouteError(
        500,
        "MISSING_CONFIG",
        cause instanceof Error ? cause.message : "AI provider is not configured.",
        false,
        { phase: "config" },
      )
    }
    const response = await callAskModel({
      config,
      promptText: buildWorkspaceAskUserPrompt(parsed.data),
    })
    let modelPayload: unknown
    try {
      modelPayload = JSON.parse(extractJsonPayload(response.text))
    } catch {
      throw new AskRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI did not return a valid Workspace agent JSON answer.",
        true,
        { phase: "parse" },
      )
    }

    const validated = workspaceAskResponseSchema.safeParse(sanitizeWorkspaceAskPayload(modelPayload))
    if (!validated.success) {
      console.error("[workspace-ask] response failed validation after sanitizing", {
        issues: validated.error.issues,
        payloadPreview: JSON.stringify(modelPayload).slice(0, 2_000),
      })
      throw new AskRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI did not return a valid Workspace agent answer.",
        true,
        { phase: "parse" },
      )
    }

    const data: WorkspaceAskApiPayload = {
      ...validated.data,
      model: config.model,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      latencyMs: Date.now() - startedAt,
    }

    return withCorsHeaders(NextResponse.json({ data, error: null }), request)
  } catch (cause) {
    const error = cause instanceof AskRouteError
      ? cause
      : new AskRouteError(
          500,
          "AI_REQUEST_FAILED",
          "The Workspace agent could not answer right now.",
          true,
          { phase: "config" },
        )
    console.error("[workspace-ask] request failed", {
      userId,
      code: error.code,
      phase: error.details.phase,
      providerStatus: error.details.providerStatus,
    })
    return withCorsHeaders(jsonError(error.status, error.code, error.message, {
      retryable: error.retryable,
      details: error.details,
    }), request)
  }
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
