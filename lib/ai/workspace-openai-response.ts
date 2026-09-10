import type { getOpenAIWorkspaceProviderConfig } from "@/lib/ai/openai-workspace-provider-config"
import {
  appendWorkspaceResponseTrace,
  createWorkspaceExecutionReceipt,
  withWorkspaceExecutionOutcome,
  type WorkspaceExecutionContext,
  type WorkspaceExecutionReceipt,
} from "@/lib/ai/workspace-execution-receipt"
import { workspaceExecutionMetadata } from "@/lib/ai/workspace-execution-receipt"

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
      metadata: workspaceExecutionMetadata(execution),
    }
    if (textFormat) requestBody.text = { format: textFormat }
    if (tools && tools.length > 0) {
      requestBody.tools = tools
      requestBody.tool_choice = "auto"
    }
    if (previousResponseId) requestBody.previous_response_id = previousResponseId

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
