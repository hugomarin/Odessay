import type {
  AIService,
  WorkspaceExecutionContext,
  WorkspaceExecutionReceipt,
  WorkspaceSemanticInputItem,
  WorkspaceSemanticOperation,
  WorkspaceSemanticRoundResult,
  WorkspaceSemanticToolCall,
  WorkspaceSemanticToolDescriptor,
} from "@/lib/services/contracts/ai-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import {
  mergeWorkspaceExecutionReceipts,
  withWorkspaceExecutionOutcome,
} from "@/lib/ai/workspace-execution-receipt"
import {
  type WorkspaceSemanticToolRegistry,
  type WorkspaceSemanticToolResult,
} from "@/lib/ai/workspace-semantic-tool-registry"
import type { WorkspaceAgentEvidence } from "@/lib/services/contracts/workspace-agent"

export const WORKSPACE_SEMANTIC_MAX_ROUNDS = 3
export const WORKSPACE_SEMANTIC_MAX_TOOL_CALLS = 8
export const WORKSPACE_SEMANTIC_MAX_EVIDENCE_REFS_PER_FOLLOW_UP = 4
export const WORKSPACE_SEMANTIC_MAX_TOOL_OUTPUT_BYTES = 65_536
export const WORKSPACE_SEMANTIC_MAX_WALL_CLOCK_MS = 45_000

export type WorkspaceSemanticLoopStatus =
  | "complete"
  | "insufficient_evidence"
  | "budget_exceeded"
  | "cancelled"
  | "provider_error"
  | "unable"

export type WorkspaceSemanticCoverage = "complete" | "partial" | "unknown"

export type WorkspaceSemanticToolCallTrace = {
  round: number
  callId: string
  name: string
  outcome: "executed" | "rejected"
  evidenceId: string | null
}

export type WorkspaceSemanticLoopError = {
  code: string
  message: string
  retryable: boolean
}

export type WorkspaceSemanticLoopResult = {
  operation: WorkspaceSemanticOperation
  status: WorkspaceSemanticLoopStatus
  coverage: WorkspaceSemanticCoverage
  rounds: number
  toolCalls: WorkspaceSemanticToolCallTrace[]
  evidence: WorkspaceAgentEvidence[]
  finalText: string | null
  error: WorkspaceSemanticLoopError | null
  executionReceipt: WorkspaceExecutionReceipt | null
}

export type WorkspaceSemanticLoopCaps = {
  maxRounds?: number
  maxToolCalls?: number
  maxEvidenceRefsPerFollowUp?: number
  maxToolOutputBytes?: number
  maxWallClockMs?: number
}

export type WorkspaceSemanticLoopInput = {
  operation: WorkspaceSemanticOperation
  execution: WorkspaceExecutionContext
  initialInput: readonly WorkspaceSemanticInputItem[]
  initialEvidence: readonly WorkspaceAgentEvidence[]
  tools?: readonly WorkspaceSemanticToolDescriptor[]
  registry: WorkspaceSemanticToolRegistry
  aiService: Pick<AIService, "runSemanticRound">
  signal?: AbortSignal
  caps?: WorkspaceSemanticLoopCaps
}

const DEADLINE = Symbol("workspace-semantic-deadline")

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function serviceError(error: ServiceError | WorkspaceSemanticLoopError): WorkspaceSemanticLoopError {
  return { code: error.code, message: error.message, retryable: error.retryable }
}

function receiptFromError(error: ServiceError): WorkspaceExecutionReceipt | null {
  const receipt = error.details?.receipt
  return receipt && typeof receipt === "object" ? receipt as WorkspaceExecutionReceipt : null
}

function productStatusFor(status: WorkspaceSemanticLoopStatus): "validated" | "invalid-output" | "incomplete" | "provider-error" {
  if (status === "complete") return "validated"
  if (status === "provider_error") return "provider-error"
  if (status === "unable") return "invalid-output"
  return "incomplete"
}

function mergeReceipt(
  receipts: Array<WorkspaceExecutionReceipt | null | undefined>,
  status: WorkspaceSemanticLoopStatus,
): WorkspaceExecutionReceipt | null {
  const merged = mergeWorkspaceExecutionReceipts(receipts)
  return merged ? withWorkspaceExecutionOutcome(merged, productStatusFor(status)) : null
}

function parseFinalEnvelope(text: string): { coverage: WorkspaceSemanticCoverage; status: "complete" | "insufficient_evidence" } | null {
  let parsed: unknown
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const candidate = fenced?.trim() || text.trim()
    parsed = JSON.parse(candidate)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.coverage !== "complete" && record.coverage !== "partial" && record.coverage !== "unknown") return null
  if (typeof record.payload !== "string" || record.payload.length > 30_000) return null
  try {
    JSON.parse(record.payload)
  } catch {
    return null
  }
  const status = record.status === "complete" && record.coverage === "complete"
    ? "complete"
    : record.status === "insufficient_evidence" || record.coverage !== "complete"
      ? "insufficient_evidence"
      : null
  return status ? { coverage: record.coverage, status } : null
}

function resultBase(input: WorkspaceSemanticLoopInput, overrides: Partial<WorkspaceSemanticLoopResult> = {}): WorkspaceSemanticLoopResult {
  return {
    operation: input.operation,
    status: "unable",
    coverage: "unknown",
    rounds: 0,
    toolCalls: [],
    evidence: [...input.initialEvidence],
    finalText: null,
    error: null,
    executionReceipt: null,
    ...overrides,
  }
}

function finish(
  input: WorkspaceSemanticLoopInput,
  receipts: Array<WorkspaceExecutionReceipt | null | undefined>,
  status: WorkspaceSemanticLoopStatus,
  rounds: number,
  toolCalls: WorkspaceSemanticToolCallTrace[],
  evidence: WorkspaceAgentEvidence[],
  overrides: Partial<WorkspaceSemanticLoopResult> = {},
): ServiceResponse<WorkspaceSemanticLoopResult> {
  return ok(resultBase(input, {
    status,
    rounds,
    toolCalls,
    evidence,
    executionReceipt: mergeReceipt(receipts, status),
    ...overrides,
  }))
}

async function callWithDeadline(
  aiService: Pick<AIService, "runSemanticRound">,
  request: Parameters<AIService["runSemanticRound"]>[0],
  remainingMs: number,
): Promise<ServiceResponse<WorkspaceSemanticRoundResult> | typeof DEADLINE> {
  if (remainingMs <= 0) return DEADLINE
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), remainingMs)
  })
  try {
    return await Promise.race([aiService.runSemanticRound(request), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function executeToolWithDeadline(
  registry: WorkspaceSemanticToolRegistry,
  call: WorkspaceSemanticToolCall,
  remainingMs: number,
): Promise<ServiceResponse<WorkspaceSemanticToolResult> | typeof DEADLINE> {
  if (remainingMs <= 0) return DEADLINE
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), remainingMs)
  })
  try {
    return await Promise.race([registry.execute(call), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function appendEvidence(
  evidence: WorkspaceAgentEvidence[],
  result: WorkspaceSemanticToolResult,
): WorkspaceAgentEvidence[] {
  if (evidence.some((item) => item.evidenceId === result.evidence.evidenceId)) return evidence
  return [...evidence, result.evidence]
}

function toolCallLabel(call: WorkspaceSemanticToolCall): Pick<WorkspaceSemanticToolCallTrace, "callId" | "name"> {
  return { callId: call.callId, name: call.name }
}

export async function runWorkspaceSemanticLoop(
  input: WorkspaceSemanticLoopInput,
): Promise<ServiceResponse<WorkspaceSemanticLoopResult>> {
  const caps = {
    maxRounds: Math.max(0, Math.min(input.caps?.maxRounds ?? WORKSPACE_SEMANTIC_MAX_ROUNDS, WORKSPACE_SEMANTIC_MAX_ROUNDS)),
    maxToolCalls: Math.max(0, Math.min(input.caps?.maxToolCalls ?? WORKSPACE_SEMANTIC_MAX_TOOL_CALLS, WORKSPACE_SEMANTIC_MAX_TOOL_CALLS)),
    maxEvidenceRefsPerFollowUp: Math.max(0, Math.min(input.caps?.maxEvidenceRefsPerFollowUp ?? WORKSPACE_SEMANTIC_MAX_EVIDENCE_REFS_PER_FOLLOW_UP, WORKSPACE_SEMANTIC_MAX_EVIDENCE_REFS_PER_FOLLOW_UP)),
    maxToolOutputBytes: Math.max(0, Math.min(input.caps?.maxToolOutputBytes ?? WORKSPACE_SEMANTIC_MAX_TOOL_OUTPUT_BYTES, WORKSPACE_SEMANTIC_MAX_TOOL_OUTPUT_BYTES)),
    maxWallClockMs: Math.max(0, Math.min(input.caps?.maxWallClockMs ?? WORKSPACE_SEMANTIC_MAX_WALL_CLOCK_MS, WORKSPACE_SEMANTIC_MAX_WALL_CLOCK_MS)),
  }
  const tools = [...(input.tools ?? input.registry.descriptors)]
  const initialInputBytes = input.initialInput.reduce((total, item) => total + bytes(item.type === "message" ? item.content : item.output), 0)
  const startedAt = Date.now()
  const receipts: Array<WorkspaceExecutionReceipt | null> = []
  const traces: WorkspaceSemanticToolCallTrace[] = []
  let evidence = [...input.initialEvidence]
  let rounds = 0
  let toolCallCount = 0
  let aggregateToolOutputBytes = input.initialEvidence.reduce((total, item) => total + bytes(item.text), 0)
  let nextInput = [...input.initialInput]
  let previousResponseId: string | null = null

  const stop = (
    status: WorkspaceSemanticLoopStatus,
    overrides: Partial<WorkspaceSemanticLoopResult> = {},
  ) => finish(input, receipts, status, rounds, traces, evidence, overrides)

  if (tools.length > 4 || initialInputBytes > WORKSPACE_SEMANTIC_MAX_TOOL_OUTPUT_BYTES || aggregateToolOutputBytes > WORKSPACE_SEMANTIC_MAX_TOOL_OUTPUT_BYTES) {
    return stop("budget_exceeded", {
      error: { code: "BUDGET_EXCEEDED", message: "Semantic input or evidence exceeded the bounded context budget.", retryable: false },
    })
  }

  while (rounds < caps.maxRounds) {
    if (input.signal?.aborted) return stop("cancelled", { error: { code: "CANCELLED", message: "Semantic review was cancelled.", retryable: false } })
    const remaining = caps.maxWallClockMs - (Date.now() - startedAt)
    if (remaining <= 0) {
      return stop("budget_exceeded", { error: { code: "DEADLINE_EXCEEDED", message: "Semantic review reached its time budget.", retryable: false } })
    }

    rounds += 1
    let response: ServiceResponse<WorkspaceSemanticRoundResult> | typeof DEADLINE
    try {
      response = await callWithDeadline(input.aiService, {
        operation: input.operation,
        input: nextInput,
        tools,
        previousResponseId,
        execution: input.execution,
      }, remaining)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Semantic provider request failed."
      return stop("provider_error", { error: { code: "AI_REQUEST_FAILED", message, retryable: true } })
    }
    if (response === DEADLINE) {
      return stop("budget_exceeded", { error: { code: "DEADLINE_EXCEEDED", message: "Semantic review reached its time budget.", retryable: false } })
    }

    if (response.error || !response.data) {
      if (response.error) receipts.push(receiptFromError(response.error))
      return stop("provider_error", { error: response.error ? serviceError(response.error) : {
        code: "AI_REQUEST_FAILED",
        message: "Semantic provider returned no response.",
        retryable: true,
      } })
    }

    if (
      response.data.executionReceipt
      && (
        response.data.executionReceipt.invocationId !== input.execution.invocationId
        || response.data.executionReceipt.action !== input.execution.action
        || response.data.executionReceipt.stage !== input.execution.stage
        || response.data.executionReceipt.runtime !== input.execution.runtime
      )
    ) {
      receipts.push(response.data.executionReceipt)
      return stop("unable", {
        error: { code: "INVOCATION_MISMATCH", message: "Semantic response did not belong to the active invocation.", retryable: false },
      })
    }

    receipts.push(response.data.executionReceipt)
    const round = response.data
    previousResponseId = round.responseId

    if (round.status !== "requires_tool" || round.toolCalls.length === 0) {
      if (round.status === "incomplete") {
        return stop("unable", {
          finalText: round.outputText,
          error: { code: "INCOMPLETE_OUTPUT", message: "Semantic provider returned incomplete output.", retryable: true },
        })
      }
      if (round.status === "refused") {
        return stop("unable", {
          error: { code: "AI_RESPONSE_REFUSED", message: "Semantic provider refused the review.", retryable: false },
        })
      }
      if (round.status === "empty" || !round.outputText) {
        return stop("unable", {
          error: { code: "AI_RESPONSE_PARSE_FAILED", message: "Semantic provider returned an empty result.", retryable: true },
        })
      }
      const final = parseFinalEnvelope(round.outputText)
      if (!final) {
        return stop("unable", {
          finalText: round.outputText,
          error: { code: "AI_RESPONSE_PARSE_FAILED", message: "Semantic provider returned an invalid final result envelope.", retryable: true },
        })
      }
      return stop(final.status, { coverage: final.coverage, finalText: round.outputText })
    }

    if (!round.responseId) {
      return stop("unable", { error: { code: "AI_RESPONSE_PARSE_FAILED", message: "Semantic tool calls require a provider response id.", retryable: true } })
    }
    if (round.toolCalls.length > caps.maxEvidenceRefsPerFollowUp || toolCallCount + round.toolCalls.length > caps.maxToolCalls) {
      return stop("budget_exceeded", {
        error: { code: "BUDGET_EXCEEDED", message: "Semantic evidence requests exceeded the bounded tool-call budget.", retryable: false },
      })
    }
    if (rounds >= caps.maxRounds) {
      return stop("budget_exceeded", {
        error: { code: "BUDGET_EXCEEDED", message: "Semantic review reached its maximum number of rounds.", retryable: false },
      })
    }

    const followUpInput: WorkspaceSemanticInputItem[] = []
    for (const call of round.toolCalls) {
      if (input.signal?.aborted) return stop("cancelled", { error: { code: "CANCELLED", message: "Semantic review was cancelled.", retryable: false } })
      const callRemaining = caps.maxWallClockMs - (Date.now() - startedAt)
      if (callRemaining <= 0) {
        return stop("budget_exceeded", { error: { code: "DEADLINE_EXCEEDED", message: "Semantic review reached its time budget.", retryable: false } })
      }

      const label = toolCallLabel(call)
      const validated = input.registry.validateCall(call)
      if (validated.error || !validated.data) {
        traces.push({ ...label, round: rounds, outcome: "rejected", evidenceId: null })
        const error = validated.error ?? { code: "INVALID_INPUT", message: "Semantic tool call could not be validated.", retryable: false }
        const status: WorkspaceSemanticLoopStatus = error.code === "CONFLICT" ? "insufficient_evidence" : "unable"
        return stop(status, {
          error: serviceError(error),
          coverage: status === "insufficient_evidence" ? "partial" : "unknown",
        })
      }

      let toolResult: ServiceResponse<WorkspaceSemanticToolResult> | typeof DEADLINE
      try {
        toolResult = await executeToolWithDeadline(input.registry, call, callRemaining)
      } catch (cause) {
        traces.push({ ...label, round: rounds, outcome: "rejected", evidenceId: null })
        return stop("unable", {
          error: {
            code: "UNAVAILABLE",
            message: cause instanceof Error ? cause.message : "Semantic evidence tool failed.",
            retryable: true,
          },
        })
      }
      if (toolResult === DEADLINE) {
        return stop("budget_exceeded", { error: { code: "DEADLINE_EXCEEDED", message: "Semantic review reached its time budget.", retryable: false } })
      }
      if (toolResult.error || !toolResult.data) {
        traces.push({ ...label, round: rounds, outcome: "rejected", evidenceId: null })
        const error = toolResult.error ?? { code: "UNAVAILABLE", message: "Semantic evidence tool returned no result.", retryable: true }
        const status: WorkspaceSemanticLoopStatus = error.code === "CONFLICT" ? "insufficient_evidence" : "unable"
        return stop(status, {
          error: serviceError(error),
          coverage: status === "insufficient_evidence" ? "partial" : "unknown",
        })
      }
      const outputBytes = bytes(toolResult.data.output)
      if (aggregateToolOutputBytes + outputBytes > Math.min(caps.maxToolOutputBytes, WORKSPACE_SEMANTIC_MAX_TOOL_OUTPUT_BYTES)) {
        return stop("budget_exceeded", {
          error: { code: "BUDGET_EXCEEDED", message: "Semantic evidence output exceeded the bounded byte budget.", retryable: false },
        })
      }
      aggregateToolOutputBytes += outputBytes
      toolCallCount += 1
      evidence = appendEvidence(evidence, toolResult.data)
      traces.push({ ...label, round: rounds, outcome: "executed", evidenceId: toolResult.data.evidence.evidenceId })
      followUpInput.push({ type: "function_call_output", callId: call.callId, output: toolResult.data.output })
    }
    nextInput = followUpInput
  }

  return stop("budget_exceeded", {
    error: { code: "BUDGET_EXCEEDED", message: "Semantic review reached its maximum number of rounds.", retryable: false },
  })
}
