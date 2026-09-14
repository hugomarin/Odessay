// class: detail (one bounded semantic Responses round; orchestration stays in shared application code)
export const runtime = "nodejs"
export const maxDuration = 240

import { NextResponse } from "next/server"
import {
  buildWorkspaceSemanticSystemPrompt,
  normalizeWorkspaceSemanticProviderResponse,
  toWorkspaceSemanticProviderInput,
  toWorkspaceSemanticProviderTools,
  workspaceSemanticRoundRequestSchema,
  WorkspaceSemanticRoundParseError,
} from "@/lib/ai/workspace-semantic-round"
import { getOpenAIWorkspaceProviderConfig } from "@/lib/ai/openai-workspace-provider-config"
import {
  createWorkspaceExecutionReceipt,
  countWorkspaceCompactionItems,
  mergeWorkspaceExecutionReceipts,
  normalizeWorkspaceExecutionContext,
  withWorkspaceExecutionOutcome,
  type WorkspaceExecutionReceipt,
} from "@/lib/ai/workspace-execution-receipt"
import {
  assertWorkspaceContextPlanCapacity,
  estimateWorkspaceTokens,
  planWorkspaceSemanticBatches,
  WorkspaceContextCapacityError,
} from "@/lib/ai/workspace-context-capacity"
import {
  callWorkspaceOpenAIResponse,
  WORKSPACE_OPENAI_REQUEST_TIMEOUT_MS,
  WorkspaceOpenAIResponseError,
} from "@/lib/ai/workspace-openai-response"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

type SemanticRoundRouteErrorDetails = {
  providerStatus?: number
  providerBodyClass?: string
  phase?: "provider" | "parse" | "config"
  receipt?: WorkspaceExecutionReceipt
}

class SemanticRoundRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details: SemanticRoundRouteErrorDetails = {},
  ) {
    super(message)
    this.name = "SemanticRoundRouteError"
  }
}

const jsonError = (
  status: number,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: SemanticRoundRouteErrorDetails } = {},
) => NextResponse.json({
  data: null,
  error: {
    code,
    message,
    retryable: options.retryable ?? (status >= 500 || status === 429),
    ...(options.details ? { details: options.details } : {}),
  },
}, { status })

function routeErrorFromOpenAI(cause: WorkspaceOpenAIResponseError): SemanticRoundRouteError {
  return new SemanticRoundRouteError(cause.status, cause.code, cause.message, cause.retryable, cause.details)
}

function operationStage(operation: "relations" | "merge") {
  return operation === "merge" ? "synthesis" as const : "semantic-review" as const
}

export async function POST(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "Sign in to run a semantic workspace review."), request)
  }

  const parsed = workspaceSemanticRoundRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Could not read the semantic workspace review request."), request)
  }

  const normalizedExecution = normalizeWorkspaceExecutionContext(parsed.data.execution, {
    action: parsed.data.operation,
    stage: operationStage(parsed.data.operation),
    runtime: "cloud",
  })
  const execution = {
    ...normalizedExecution,
    action: parsed.data.operation,
    stage: operationStage(parsed.data.operation),
    runtime: "cloud" as const,
  }
  const initialReceipt = createWorkspaceExecutionReceipt(execution)
  const startedAt = Date.now()
  let configuredModel: string | null = null

  try {
    let config: ReturnType<typeof getOpenAIWorkspaceProviderConfig>
    try {
      config = getOpenAIWorkspaceProviderConfig()
      configuredModel = config.model
    } catch (cause) {
      throw new SemanticRoundRouteError(
        500,
        "MISSING_CONFIG",
        cause instanceof Error ? cause.message : "AI provider is not configured.",
        false,
        { phase: "config", receipt: withWorkspaceExecutionOutcome(initialReceipt, "provider-error") },
      )
    }

    let response: Awaited<ReturnType<typeof callWorkspaceOpenAIResponse>>
    try {
      const systemPrompt = buildWorkspaceSemanticSystemPrompt()
      const maxOutputTokens = Math.max(config.maxOutputTokens, 8_192)
      const providerTools = toWorkspaceSemanticProviderTools(parsed.data.tools)
      const finalTextFormat = {
          type: "json_schema",
          name: "WorkspaceSemanticFinalEnvelope",
          description: "Final semantic review status. Use only when no more evidence is needed.",
          schema: {
            type: "object",
            properties: {
              coverage: { type: "string", enum: ["complete", "partial", "unknown"] },
              status: { type: "string", enum: ["complete", "insufficient_evidence"] },
              payload: { type: "string", description: "JSON-encoded operation result, bounded to the application contract." },
            },
            required: ["coverage", "status", "payload"],
            additionalProperties: false,
          },
            strict: true,
      } as const
      const batchPlan = planWorkspaceSemanticBatches(parsed.data.input, {
        contextWindowTokens: config.contextWindowTokens ?? null,
        reservedOutputTokens: maxOutputTokens,
        systemPromptTokens: estimateWorkspaceTokens(systemPrompt),
        schemaAndToolTokens: estimateWorkspaceTokens(JSON.stringify(providerTools))
          + estimateWorkspaceTokens(JSON.stringify(finalTextFormat)),
        historyTokens: parsed.data.previousResponseId ? config.historyReserveTokens : 0,
        reasoningTokens: config.reasoningReserveTokens,
        safetyMarginTokens: config.safetyMarginTokens,
      })
      assertWorkspaceContextPlanCapacity(batchPlan)
      if (batchPlan.staged && !config.compactionThresholdTokens) {
        throw new WorkspaceContextCapacityError(
          "BUDGET_EXCEEDED",
          "The selected evidence requires staged processing, but native context compaction is not configured for this deployment.",
        )
      }
      const batches = batchPlan.batches
      const receipts: WorkspaceExecutionReceipt[] = []
      let previousResponseId = parsed.data.previousResponseId ?? null
      let lastResponse: Awaited<ReturnType<typeof callWorkspaceOpenAIResponse>> | null = null

      for (const [index, batch] of batches.entries()) {
        const finalBatch = index === batches.length - 1
        const stageInstruction = finalBatch
          ? "All staged evidence has now been supplied. Produce the final semantic envelope now."
          : "This is one staged portion of the selected evidence. Do not finalize yet; acknowledge internally and wait for the next staged portion."
        const stagedInput = [
          { role: "system", content: systemPrompt },
          ...toWorkspaceSemanticProviderInput(batch),
          { role: "user", content: stageInstruction },
        ]
        lastResponse = await callWorkspaceOpenAIResponse({
          config,
          execution,
          systemPrompt,
          userPrompt: "",
          input: stagedInput,
          // Intermediate ingestion calls must not produce tool calls that we
          // could not answer before the next staged source chunk arrives.
          tools: finalBatch ? providerTools : [],
          previousResponseId,
          maxOutputTokens: finalBatch ? maxOutputTokens : Math.min(1_024, maxOutputTokens),
          timeoutMs: WORKSPACE_OPENAI_REQUEST_TIMEOUT_MS,
          textFormat: finalBatch ? finalTextFormat : null,
          contextManagement: config.compactionThresholdTokens
            ? [{ type: "compaction", compact_threshold: config.compactionThresholdTokens }]
            : undefined,
          truncation: "disabled",
          messages: {
            unavailable: "AI provider is unavailable for semantic workspace review.",
            timeout: "AI provider timed out during semantic workspace review.",
            rateLimited: "AI provider rate limited semantic workspace review.",
            contractRejected: "AI provider rejected the semantic workspace review contract.",
            authRejected: "OpenAI rejected the configured semantic workspace review credentials.",
            providerFailed: "AI provider failed semantic workspace review.",
            parseFailed: "AI provider returned an invalid semantic workspace review response.",
          },
        })
        receipts.push(lastResponse.receipt)
        previousResponseId = lastResponse.payload.id ?? null
        if (!finalBatch && !previousResponseId) {
          throw new SemanticRoundRouteError(
            502,
            "AI_RESPONSE_PARSE_FAILED",
            "OpenAI did not return a response id for staged semantic context.",
            true,
            { phase: "parse", receipt: lastResponse.receipt },
          )
        }
      }
      if (!lastResponse) throw new Error("Semantic provider returned no response.")
      response = {
        payload: lastResponse.payload,
        receipt: mergeWorkspaceExecutionReceipts(receipts) ?? lastResponse.receipt,
      }
    } catch (cause) {
      if (cause instanceof WorkspaceOpenAIResponseError) throw routeErrorFromOpenAI(cause)
      if (cause instanceof WorkspaceContextCapacityError) {
        throw new SemanticRoundRouteError(
          cause.code === "CAPACITY_UNKNOWN" ? 503 : 413,
          cause.code,
          cause.message,
          false,
          { phase: "config", receipt: initialReceipt },
        )
      }
      throw cause
    }

    let normalized
    try {
      normalized = normalizeWorkspaceSemanticProviderResponse(
        response.payload,
        response.receipt,
        parsed.data.tools.map((tool) => tool.name),
      )
    } catch (cause) {
      if (cause instanceof WorkspaceSemanticRoundParseError) {
        throw new SemanticRoundRouteError(
          502,
          cause.code,
          cause.message,
          true,
          { phase: "parse", receipt: withWorkspaceExecutionOutcome(response.receipt, "invalid-output") },
        )
      }
      throw cause
    }

    const productStatus = normalized.status === "completed"
      ? "validated"
      : normalized.status === "requires_tool"
        ? "not-evaluated"
        : normalized.status === "refused"
          ? "refused"
          : "incomplete"
    const receipt = withWorkspaceExecutionOutcome(response.receipt, productStatus)
    const data = { ...normalized, executionReceipt: receipt }
    const latest = receipt.responses.at(-1)

    console.info("[workspace-semantic-round] response stored", {
      userId,
      invocationId: receipt.invocationId,
      supportId: receipt.supportId,
      action: receipt.action,
      stage: receipt.stage,
      runtime: receipt.runtime,
      contextVersion: receipt.contextVersion,
      responseIds: receipt.responses.map((item) => item.responseId).filter(Boolean),
      model: latest?.model ?? config.model,
      providerStatus: latest?.status ?? null,
      semanticStatus: normalized.status,
      productStatus: receipt.productStatus,
      outputItems: latest?.outputItems.length ?? 0,
      toolCalls: normalized.toolCalls.length,
      compactionCount: countWorkspaceCompactionItems(receipt),
      latencyMs: Date.now() - startedAt,
      error: null,
    })

    return withCorsHeaders(NextResponse.json({ data, error: null }), request)
  } catch (cause) {
    const error = cause instanceof SemanticRoundRouteError
      ? cause
      : new SemanticRoundRouteError(
          500,
          "AI_REQUEST_FAILED",
          "Semantic workspace review could not be completed.",
          true,
          { phase: "config", receipt: withWorkspaceExecutionOutcome(initialReceipt, "provider-error") },
        )
    const receipt = error.details.receipt ?? initialReceipt
    const latest = receipt.responses.at(-1)
    console.error("[workspace-semantic-round] request failed", {
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
      latencyMs: Date.now() - startedAt,
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
