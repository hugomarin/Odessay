// class: detail (short, low-cost rephrasing of already-computed facts; never grounds new evidence)
export const runtime = "nodejs"
export const maxDuration = 30

import { NextResponse } from "next/server"
import {
  buildWorkspaceToolPresentationSystemPrompt,
  buildWorkspaceToolPresentationUserPrompt,
  sanitizeWorkspaceToolPresentationPayload,
  workspaceToolPresentationRequestSchema,
  workspaceToolPresentationTextFormat,
  workspaceToolPresentationResponseSchema,
  type WorkspaceToolPresentationApiPayload,
} from "@/lib/ai/workspace-tool-presentation"
import { getOpenAIWorkspaceProviderConfig } from "@/lib/ai/openai-workspace-provider-config"
import {
  createWorkspaceExecutionReceipt,
  normalizeWorkspaceExecutionContext,
  withWorkspaceExecutionOutcome,
  type WorkspaceExecutionReceipt,
} from "@/lib/ai/workspace-execution-receipt"
import {
  callWorkspaceOpenAIResponse,
  WorkspaceOpenAIResponseError,
} from "@/lib/ai/workspace-openai-response"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

type PresentationRouteErrorDetails = {
  providerStatus?: number
  providerBodyClass?: string
  phase?: "provider" | "parse" | "config"
  receipt?: WorkspaceExecutionReceipt
}

class PresentationRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details: PresentationRouteErrorDetails = {},
  ) {
    super(message)
    this.name = "PresentationRouteError"
  }
}

const jsonError = (
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: PresentationRouteErrorDetails } = {},
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

function routeErrorFromOpenAI(cause: WorkspaceOpenAIResponseError): PresentationRouteError {
  return new PresentationRouteError(cause.status, cause.code, cause.message, cause.retryable, cause.details)
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "Sign in to use the Workspace agent."), request)
  }

  const parsed = workspaceToolPresentationRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Could not read the Workspace agent presentation request."), request)
  }

  const execution = normalizeWorkspaceExecutionContext(parsed.data.execution ? {
    ...parsed.data.execution,
    stage: "presentation",
  } : undefined, {
    action: parsed.data.execution?.action ?? "presentation",
    runtime: "cloud",
    stage: "presentation",
  })
  const initialReceipt = createWorkspaceExecutionReceipt(execution)
  const startedAt = Date.now()
  let configuredModel: string | null = null

  try {
    let config: ReturnType<typeof getOpenAIWorkspaceProviderConfig>
    try {
      config = getOpenAIWorkspaceProviderConfig()
      configuredModel = config.model
    } catch (cause) {
      throw new PresentationRouteError(
        500,
        "MISSING_CONFIG",
        cause instanceof Error ? cause.message : "AI provider is not configured.",
        false,
        { phase: "config", receipt: withWorkspaceExecutionOutcome(initialReceipt, "provider-error") },
      )
    }

    let response: Awaited<ReturnType<typeof callWorkspaceOpenAIResponse>>
    try {
      response = await callWorkspaceOpenAIResponse({
        config,
        execution,
        systemPrompt: buildWorkspaceToolPresentationSystemPrompt(),
        userPrompt: buildWorkspaceToolPresentationUserPrompt(parsed.data),
        maxOutputTokens: Math.max(config.maxOutputTokens, 1_024),
        timeoutMs: 20_000,
        textFormat: workspaceToolPresentationTextFormat,
        messages: {
          unavailable: "AI provider is unavailable for the Workspace agent.",
          timeout: "AI provider timed out while phrasing the result.",
          rateLimited: "AI provider rate limited the Workspace agent.",
          contractRejected: "AI provider rejected the Workspace agent contract.",
          authRejected: "OpenAI rejected the configured Workspace agent credentials.",
          providerFailed: "AI provider failed to phrase the result.",
          parseFailed: "AI provider returned an invalid Workspace agent response.",
        },
      })
    } catch (cause) {
      if (cause instanceof WorkspaceOpenAIResponseError) throw routeErrorFromOpenAI(cause)
      throw cause
    }

    const providerPayload = response.payload
    if (providerPayload.status === "incomplete") {
      throw new PresentationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI provider truncated the Workspace agent response.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "incomplete") },
      )
    }

    const refusal = providerPayload.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "refusal")
    if (refusal) {
      throw new PresentationRouteError(
        502,
        "AI_RESPONSE_REFUSED",
        "OpenAI refused to phrase the result.",
        false,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "refused") },
      )
    }

    const outputText = providerPayload.output_text
      ?? providerPayload.output
        ?.flatMap((item) => item.content ?? [])
        .filter((content) => content.type === "output_text")
        .map((content) => content.text ?? "")
        .join("")
    const text = outputText?.trim() ?? ""
    if (!text) {
      throw new PresentationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI provider returned an empty Workspace agent response.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
      )
    }

    let modelPayload: unknown
    try {
      modelPayload = JSON.parse(extractJsonPayload(text))
    } catch {
      throw new PresentationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI did not return a valid Workspace agent JSON note.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
      )
    }

    const validated = workspaceToolPresentationResponseSchema.safeParse(sanitizeWorkspaceToolPresentationPayload(modelPayload))
    if (!validated.success) {
      throw new PresentationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI did not return a valid Workspace agent note.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
      )
    }

    const receipt = withWorkspaceExecutionOutcome(response.receipt, "validated")
    const latest = receipt.responses.at(-1)
    const data: WorkspaceToolPresentationApiPayload = {
      ...validated.data,
      model: config.model,
      promptTokens: latest?.usage.promptTokens ?? null,
      completionTokens: latest?.usage.completionTokens ?? null,
      totalTokens: latest?.usage.totalTokens ?? null,
      latencyMs: Date.now() - startedAt,
      executionReceipt: receipt,
    }

    console.info("[workspace-tool-presentation] response stored", {
      userId,
      invocationId: receipt.invocationId,
      supportId: receipt.supportId,
      action: receipt.action,
      stage: receipt.stage,
      runtime: receipt.runtime,
      contextVersion: receipt.contextVersion,
      responseIds: receipt.responses.map((item) => item.responseId).filter(Boolean),
      model: latest?.model ?? config.model,
      status: latest?.status ?? null,
      providerStatus: receipt.providerStatus,
      promptTokens: latest?.usage.promptTokens ?? null,
      completionTokens: latest?.usage.completionTokens ?? null,
      totalTokens: latest?.usage.totalTokens ?? null,
      latencyMs: latest?.latencyMs ?? Date.now() - startedAt,
      error: null,
    })

    return withCorsHeaders(NextResponse.json({ data, error: null }), request)
  } catch (cause) {
    const error = cause instanceof PresentationRouteError
      ? cause
      : new PresentationRouteError(
          500,
          "AI_REQUEST_FAILED",
          "The Workspace agent could not phrase this result right now.",
          true,
          { phase: "config", receipt: withWorkspaceExecutionOutcome(initialReceipt, "provider-error") },
        )
    const receipt = error.details.receipt ?? initialReceipt
    const latest = receipt.responses.at(-1)
    console.error("[workspace-tool-presentation] request failed", {
      userId,
      invocationId: receipt.invocationId,
      supportId: receipt.supportId,
      action: receipt.action,
      stage: receipt.stage,
      runtime: receipt.runtime,
      contextVersion: receipt.contextVersion,
      responseIds: receipt.responses.map((item) => item.responseId).filter(Boolean),
      model: latest?.model ?? configuredModel,
      status: latest?.status ?? null,
      providerStatus: error.details.providerStatus ?? receipt.providerStatus,
      promptTokens: latest?.usage.promptTokens ?? null,
      completionTokens: latest?.usage.completionTokens ?? null,
      totalTokens: latest?.usage.totalTokens ?? null,
      latencyMs: latest?.latencyMs ?? Date.now() - startedAt,
      error: error.code,
      phase: error.details.phase,
    })
    return withCorsHeaders(jsonError(error.status, error.code, error.message, {
      retryable: error.retryable,
      details: { ...error.details, receipt },
    }), request)
  }
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
