// class: detail (bounded semantic analysis; returns only selected proposals and optional read requests)
export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"
import {
  buildWorkspaceClassificationSystemPrompt,
  buildWorkspaceClassificationUserPrompt,
  workspaceClassificationRequestSchema,
  workspaceClassificationTextFormat,
  workspaceClassificationResponseSchema,
  type WorkspaceClassificationApiPayload,
} from "@/lib/ai/workspace-classification"
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

type ClassificationRouteErrorDetails = {
  providerStatus?: number
  providerBodyClass?: string
  phase?: "provider" | "parse" | "config"
  receipt?: WorkspaceExecutionReceipt
}

class ClassificationRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details: ClassificationRouteErrorDetails = {},
  ) {
    super(message)
    this.name = "ClassificationRouteError"
  }
}

const jsonError = (
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: ClassificationRouteErrorDetails } = {},
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

function routeErrorFromOpenAI(cause: WorkspaceOpenAIResponseError): ClassificationRouteError {
  return new ClassificationRouteError(cause.status, cause.code, cause.message, cause.retryable, cause.details)
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "Sign in to classify workspace artifacts."), request)
  }

  const parsed = workspaceClassificationRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Could not read the workspace classification request."), request)
  }

  const execution = normalizeWorkspaceExecutionContext(parsed.data.execution, {
    action: "classification",
    runtime: "cloud",
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
      throw new ClassificationRouteError(
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
        systemPrompt: buildWorkspaceClassificationSystemPrompt(),
        userPrompt: buildWorkspaceClassificationUserPrompt(parsed.data),
        maxOutputTokens: Math.max(config.maxOutputTokens, 8_192),
        timeoutMs: 45_000,
        textFormat: workspaceClassificationTextFormat,
        messages: {
          unavailable: "AI provider is unavailable for workspace classification.",
          timeout: "AI provider timed out while classifying the selected artifacts.",
          rateLimited: "AI provider rate limited workspace classification.",
          contractRejected: "AI provider rejected the workspace classification contract.",
          authRejected: "OpenAI rejected the configured workspace classification credentials.",
          providerFailed: "AI provider failed workspace classification.",
          parseFailed: "AI provider returned an invalid workspace classification response.",
        },
      })
    } catch (cause) {
      if (cause instanceof WorkspaceOpenAIResponseError) throw routeErrorFromOpenAI(cause)
      throw cause
    }

    const providerPayload = response.payload
    if (providerPayload.status === "incomplete") {
      throw new ClassificationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI provider truncated the workspace classification response.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "incomplete") },
      )
    }

    const refusal = providerPayload.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "refusal")
    if (refusal) {
      throw new ClassificationRouteError(
        502,
        "AI_RESPONSE_REFUSED",
        "OpenAI refused to classify the selected artifacts.",
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
      throw new ClassificationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI provider returned an empty workspace classification response.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
      )
    }

    let modelPayload: unknown
    try {
      modelPayload = JSON.parse(extractJsonPayload(text))
    } catch {
      throw new ClassificationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI did not return valid workspace classification JSON.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
      )
    }

    const validated = workspaceClassificationResponseSchema.safeParse(modelPayload)
    if (!validated.success) {
      throw new ClassificationRouteError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "AI did not return a valid workspace classification proposal.",
        true,
        { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
      )
    }

    const receipt = withWorkspaceExecutionOutcome(response.receipt, "validated")
    const data: WorkspaceClassificationApiPayload = {
      ...validated.data,
      model: config.model,
      promptTokens: receipt.responses.at(-1)?.usage.promptTokens ?? null,
      completionTokens: receipt.responses.at(-1)?.usage.completionTokens ?? null,
      totalTokens: receipt.responses.at(-1)?.usage.totalTokens ?? null,
      latencyMs: Date.now() - startedAt,
      executionReceipt: receipt,
    }

    const latest = receipt.responses.at(-1)
    console.info("[workspace-classification] response stored", {
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
    const error = cause instanceof ClassificationRouteError
      ? cause
      : new ClassificationRouteError(
          500,
          "AI_REQUEST_FAILED",
          "Workspace classification could not be completed.",
          true,
          { phase: "config", receipt: withWorkspaceExecutionOutcome(initialReceipt, "provider-error") },
        )
    const receipt = error.details.receipt ?? initialReceipt
    const latest = receipt.responses.at(-1)
    console.error("[workspace-classification] request failed", {
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
