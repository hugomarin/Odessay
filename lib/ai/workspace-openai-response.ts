import type { getOpenAIWorkspaceProviderConfig } from "@/lib/ai/openai-workspace-provider-config"
import {
  appendWorkspaceResponseTrace,
  createWorkspaceExecutionReceipt,
  mergeWorkspaceExecutionReceipts,
  withWorkspaceExecutionOutcome,
  type WorkspaceExecutionContext,
  type WorkspaceExecutionReceipt,
} from "@/lib/ai/workspace-execution-receipt"
import { workspaceExecutionMetadata } from "@/lib/ai/workspace-execution-receipt"
import {
  planWorkspaceTextBatches,
  type WorkspaceContextCapacity,
} from "@/lib/ai/workspace-context-capacity"

/**
 * Full multi-document synthesis can take longer than a short chat turn.
 * Keep provider calls bounded while leaving the route enough time for auth,
 * parsing and receipt persistence around the request.
 */
export const WORKSPACE_OPENAI_REQUEST_TIMEOUT_MS = 180_000

export type WorkspaceOpenAIResponsePayload = {
  id?: string
  previous_response_id?: string | null
  status?: string
  model?: string
  output_text?: string
  output?: Array<{
    id?: string
    type?: string
    status?: string
    call_id?: string
    name?: string
    arguments?: unknown
    output?: unknown
    content?: Array<{ type?: string; text?: string; refusal?: string }>
  }>
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  incomplete_details?: { reason?: string | null } | null
}

export type WorkspaceOpenAIResponseErrorDetails = {
  providerStatus?: number
  providerBodyClass?: string
  phase: "provider" | "parse"
  receipt: WorkspaceExecutionReceipt
}

export class WorkspaceOpenAIResponseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details: WorkspaceOpenAIResponseErrorDetails,
  ) {
    super(message)
    this.name = "WorkspaceOpenAIResponseError"
  }
}

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

type WorkspaceOpenAIResponseMessages = {
  unavailable: string
  timeout: string
  rateLimited: string
  contractRejected: string
  authRejected: string
  providerFailed: string
  parseFailed: string
}

export async function callWorkspaceOpenAIResponse({
  config,
  execution,
  systemPrompt,
  userPrompt,
  maxOutputTokens,
  timeoutMs,
  textFormat,
  messages,
  input,
    tools,
    previousResponseId,
    contextManagement,
    truncation = "disabled",
}: {
  config: ReturnType<typeof getOpenAIWorkspaceProviderConfig>
  execution: WorkspaceExecutionContext
  systemPrompt: string
  userPrompt: string
  maxOutputTokens: number
  timeoutMs: number
  textFormat: Record<string, unknown> | null
  messages: WorkspaceOpenAIResponseMessages
  /** Optional provider-shaped Responses input used by the semantic loop. */
  input?: unknown[]
  /** Optional provider-shaped function tools used by the semantic loop. */
  tools?: Array<Record<string, unknown>>
  previousResponseId?: string | null
  /** Optional Responses API context management configuration. */
  contextManagement?: Array<Record<string, unknown>>
  /** Workspace must never silently drop the beginning of a document context. */
  truncation?: "disabled" | "auto"
}): Promise<{ payload: WorkspaceOpenAIResponsePayload; receipt: WorkspaceExecutionReceipt }> {
  let receipt = createWorkspaceExecutionReceipt(execution)
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      input: input ?? [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: config.reasoningEffort },
      store: true,
      truncation,
      metadata: workspaceExecutionMetadata(execution),
    }
    if (textFormat) requestBody.text = { format: textFormat }
    if (tools && tools.length > 0) {
      requestBody.tools = tools
      requestBody.tool_choice = "auto"
    }
    if (previousResponseId) requestBody.previous_response_id = previousResponseId
    if (contextManagement && contextManagement.length > 0) requestBody.context_management = contextManagement

    response = await fetch(config.responsesUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${config.apiKey}`,
        "user-agent": "Odessay/1.0",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch (cause) {
    const isAbort = cause instanceof Error && cause.name === "AbortError"
    receipt = appendWorkspaceResponseTrace(receipt, null, {
      latencyMs: Date.now() - startedAt,
      errorCode: isAbort ? "TIMEOUT" : "UNAVAILABLE",
    })
    throw new WorkspaceOpenAIResponseError(
      isAbort ? 504 : 503,
      isAbort ? "TIMEOUT" : "UNAVAILABLE",
      isAbort ? messages.timeout : messages.unavailable,
      true,
      { phase: "provider", receipt: withWorkspaceExecutionOutcome(receipt, "provider-error") },
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const providerBodyClass = classifyProviderBody(await response.text())
    receipt = appendWorkspaceResponseTrace(receipt, null, {
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      errorCode: response.status === 429 ? "RATE_LIMITED" : "AI_PROVIDER_ERROR",
    })
    if (response.status === 429) {
      throw new WorkspaceOpenAIResponseError(429, "RATE_LIMITED", messages.rateLimited, true, {
        phase: "provider",
        providerStatus: response.status,
        providerBodyClass,
        receipt: withWorkspaceExecutionOutcome(receipt, "provider-error"),
      })
    }
    if (response.status === 400 || response.status === 422) {
      throw new WorkspaceOpenAIResponseError(422, "AI_PROVIDER_CONTRACT_ERROR", messages.contractRejected, false, {
        phase: "provider",
        providerStatus: response.status,
        providerBodyClass,
        receipt: withWorkspaceExecutionOutcome(receipt, "provider-error"),
      })
    }
    if (response.status === 401 || response.status === 403) {
      throw new WorkspaceOpenAIResponseError(502, "AI_PROVIDER_AUTH_ERROR", messages.authRejected, false, {
        phase: "provider",
        providerStatus: response.status,
        providerBodyClass,
        receipt: withWorkspaceExecutionOutcome(receipt, "provider-error"),
      })
    }
    throw new WorkspaceOpenAIResponseError(
      response.status >= 500 ? 503 : 502,
      response.status >= 500 ? "UNAVAILABLE" : "AI_PROVIDER_ERROR",
      response.status >= 500 ? messages.unavailable : messages.providerFailed,
      response.status >= 500,
      { phase: "provider", providerStatus: response.status, providerBodyClass, receipt: withWorkspaceExecutionOutcome(receipt, "provider-error") },
    )
  }

  let payload: WorkspaceOpenAIResponsePayload
  try {
    payload = await response.json() as WorkspaceOpenAIResponsePayload
  } catch {
    receipt = appendWorkspaceResponseTrace(receipt, null, {
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      errorCode: "AI_RESPONSE_PARSE_FAILED",
    })
    throw new WorkspaceOpenAIResponseError(502, "AI_RESPONSE_PARSE_FAILED", messages.parseFailed, true, {
      phase: "parse",
      providerStatus: response.status,
      receipt: withWorkspaceExecutionOutcome(receipt, "invalid-output"),
    })
  }

  receipt = appendWorkspaceResponseTrace(receipt, payload as Record<string, unknown>, {
    latencyMs: Date.now() - startedAt,
    httpStatus: response.status,
  })
  return { payload, receipt }
}

/**
 * Sends a large direct Ask/Classification prompt in ordered stages. Every
 * stage is chained through `previous_response_id`; no text is truncated and
 * the final stage is the only one asked to satisfy the structured output
 * contract. This is intentionally provider-level orchestration so all
 * actions share the same compaction and receipt behavior.
 */
export async function callWorkspaceOpenAIResponseStaged({
  config,
  execution,
  systemPrompt,
  userPrompt,
  maxOutputTokens,
  timeoutMs,
  textFormat,
  messages,
  previousResponseId,
  contextManagement,
  capacity,
}: Omit<Parameters<typeof callWorkspaceOpenAIResponse>[0], "input" | "tools" | "truncation"> & {
  capacity: WorkspaceContextCapacity
}): Promise<{ payload: WorkspaceOpenAIResponsePayload; receipt: WorkspaceExecutionReceipt; staged: boolean }> {
  const plan = planWorkspaceTextBatches(userPrompt, {
    ...capacity,
    // Include the system prompt and the small protocol envelope in the
    // capacity calculation. These are provider input tokens, not a product
    // limit; omitting them makes the final staged request fail at the edge of
    // the real model window.
    overheadTokens: (capacity.overheadTokens ?? 0)
      + Math.ceil(systemPrompt.length / 4)
      + Math.ceil("Staged context part. Preserve this content as evidence in the current scope. All staged context is now available. Return the final structured answer.".length / 4),
  })
  let head = previousResponseId ?? null
  let last: { payload: WorkspaceOpenAIResponsePayload; receipt: WorkspaceExecutionReceipt } | null = null
  const receipts: WorkspaceExecutionReceipt[] = []

  for (const [index, part] of plan.batches.entries()) {
    const finalStage = index === plan.batches.length - 1
    const stagePrompt = [
      `Staged context part ${index + 1}/${plan.batches.length}. Preserve this content as evidence in the current scope.`,
      part,
      finalStage
        ? "All staged context is now available. Return the final structured answer."
        : "Do not finalize yet. Wait for the next staged context part.",
    ].join("\n\n")
    last = await callWorkspaceOpenAIResponse({
      config,
      execution,
      systemPrompt,
      userPrompt: "",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: stagePrompt },
      ],
      previousResponseId: head,
      maxOutputTokens: finalStage ? maxOutputTokens : Math.min(1_024, maxOutputTokens),
      timeoutMs,
      textFormat: finalStage ? textFormat : null,
      contextManagement,
      truncation: "disabled",
      messages,
    })
    receipts.push(last.receipt)
    head = last.payload.id ?? null
    if (!finalStage && !head) {
      throw new WorkspaceOpenAIResponseError(
        502,
        "AI_RESPONSE_PARSE_FAILED",
        "OpenAI did not return a response id for staged workspace context.",
        true,
        { phase: "parse", receipt: last.receipt },
      )
    }
  }

  if (!last) throw new Error("Workspace provider returned no response.")
  return {
    payload: last.payload,
    receipt: mergeWorkspaceExecutionReceipts(receipts) ?? last.receipt,
    staged: plan.staged,
  }
}
