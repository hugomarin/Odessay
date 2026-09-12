import { z } from "zod"
import type {
  WorkspaceExecutionAction,
  WorkspaceExecutionContext,
  WorkspaceExecutionProductStatus,
  WorkspaceExecutionReceipt,
  WorkspaceExecutionRuntime,
  WorkspaceExecutionStage,
  WorkspaceResponseItemSummary,
  WorkspaceResponseTrace,
} from "@/lib/services/contracts/ai-service"
export type {
  WorkspaceExecutionAction,
  WorkspaceExecutionContext,
  WorkspaceExecutionProductStatus,
  WorkspaceExecutionReceipt,
  WorkspaceExecutionRuntime,
  WorkspaceExecutionStage,
  WorkspaceResponseItemSummary,
  WorkspaceResponseTrace,
} from "@/lib/services/contracts/ai-service"

export const WORKSPACE_EXECUTION_CONTEXT_VERSION = "workspace-agent-v1"
export const MAX_WORKSPACE_INVOCATION_ID_CHARS = 128
export const MAX_WORKSPACE_CONTEXT_VERSION_CHARS = 64
export const MAX_WORKSPACE_RESPONSE_ITEMS = 32

export const WORKSPACE_EXECUTION_ACTIONS = [
  "classification",
  "ask",
  "presentation",
  "relations",
  "merge",
] as const

export const WORKSPACE_EXECUTION_STAGES = [
  "analysis",
  "context-acquisition",
  "presentation",
  "semantic-review",
  "synthesis",
] as const

export const WORKSPACE_EXECUTION_RUNTIMES = ["web", "desktop", "cloud"] as const

export const workspaceExecutionContextSchema = z.object({
  invocationId: z.string().trim().min(1).max(MAX_WORKSPACE_INVOCATION_ID_CHARS),
  action: z.enum(WORKSPACE_EXECUTION_ACTIONS),
  stage: z.enum(WORKSPACE_EXECUTION_STAGES),
  runtime: z.enum(WORKSPACE_EXECUTION_RUNTIMES),
  contextVersion: z.string().trim().min(1).max(MAX_WORKSPACE_CONTEXT_VERSION_CHARS).nullable().optional(),
})


const defaultStageForAction: Record<WorkspaceExecutionAction, WorkspaceExecutionStage> = {
  classification: "analysis",
  ask: "analysis",
  presentation: "presentation",
  relations: "semantic-review",
  merge: "synthesis",
}

function randomInvocationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function boundedString(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

export function createWorkspaceExecutionContext(
  action: WorkspaceExecutionAction,
  runtime: WorkspaceExecutionRuntime = "cloud",
  stage = defaultStageForAction[action],
): WorkspaceExecutionContext {
  return {
    invocationId: randomInvocationId().slice(0, MAX_WORKSPACE_INVOCATION_ID_CHARS),
    action,
    stage,
    runtime,
    contextVersion: WORKSPACE_EXECUTION_CONTEXT_VERSION,
  }
}

export function normalizeWorkspaceExecutionContext(
  input: Partial<WorkspaceExecutionContext> | null | undefined,
  defaults: {
    action: WorkspaceExecutionAction
    runtime?: WorkspaceExecutionRuntime
    stage?: WorkspaceExecutionStage
  },
): WorkspaceExecutionContext {
  const generated = createWorkspaceExecutionContext(
    defaults.action,
    defaults.runtime ?? "cloud",
    defaults.stage ?? defaultStageForAction[defaults.action],
  )
  return {
    invocationId: boundedString(input?.invocationId, MAX_WORKSPACE_INVOCATION_ID_CHARS) ?? generated.invocationId,
    action: defaults.action,
    stage: input?.stage ?? generated.stage,
    runtime: input?.runtime ?? generated.runtime,
    contextVersion: boundedString(input?.contextVersion, MAX_WORKSPACE_CONTEXT_VERSION_CHARS) ?? generated.contextVersion,
  }
}

export function workspaceExecutionMetadata(context: WorkspaceExecutionContext): Record<string, string> {
  return {
    invocation_id: context.invocationId.slice(0, MAX_WORKSPACE_INVOCATION_ID_CHARS),
    action: context.action,
    stage: context.stage,
    runtime: context.runtime,
    context_version: (context.contextVersion ?? WORKSPACE_EXECUTION_CONTEXT_VERSION).slice(0, MAX_WORKSPACE_CONTEXT_VERSION_CHARS),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function hasTextValue(value: unknown): boolean {
  if (typeof value === "string" && value.trim()) return true
  if (!Array.isArray(value)) return false
  return value.some((entry) => {
    const record = asRecord(entry)
    return Boolean(record && (stringValue(record.text) || hasTextValue(record.content)))
  })
}

export function summarizeWorkspaceResponseItems(output: unknown): {
  items: WorkspaceResponseItemSummary[]
  truncated: boolean
} {
  if (!Array.isArray(output)) return { items: [], truncated: false }
  const items = output.slice(0, MAX_WORKSPACE_RESPONSE_ITEMS).map((entry): WorkspaceResponseItemSummary => {
    const record = asRecord(entry)
    const content = record?.content
    return {
      id: stringValue(record?.id),
      type: stringValue(record?.type) ?? "unknown",
      status: stringValue(record?.status),
      callId: stringValue(record?.call_id) ?? stringValue(record?.callId),
      name: stringValue(record?.name),
      hasArguments: record?.arguments !== undefined,
      hasOutput: record?.output !== undefined || record?.content !== undefined,
      hasText: hasTextValue(record?.text) || hasTextValue(content),
    }
  })
  return { items, truncated: output.length > MAX_WORKSPACE_RESPONSE_ITEMS }
}

export function createWorkspaceExecutionReceipt(context: WorkspaceExecutionContext): WorkspaceExecutionReceipt {
  return {
    invocationId: context.invocationId,
    supportId: context.invocationId,
    action: context.action,
    stage: context.stage,
    runtime: context.runtime,
    contextVersion: context.contextVersion ?? WORKSPACE_EXECUTION_CONTEXT_VERSION,
    providerStatus: null,
    productStatus: "not-evaluated",
    responses: [],
  }
}

export function appendWorkspaceResponseTrace(
  receipt: WorkspaceExecutionReceipt,
  payload: Record<string, unknown> | null,
  options: {
    latencyMs?: number | null
    httpStatus?: number | null
    errorCode?: string | null
  } = {},
): WorkspaceExecutionReceipt {
  const usagePayload = asRecord(payload?.usage)
  const responseId = stringValue(payload?.id)
  const outputSummary = summarizeWorkspaceResponseItems(payload?.output)
  const trace: WorkspaceResponseTrace = {
    action: receipt.action,
    stage: receipt.stage,
    runtime: receipt.runtime,
    contextVersion: receipt.contextVersion,
    responseId,
    previousResponseId: stringValue(payload?.previous_response_id) ?? stringValue(payload?.previousResponseId),
    status: stringValue(payload?.status),
    model: stringValue(payload?.model),
    httpStatus: options.httpStatus ?? null,
    usage: {
      model: stringValue(payload?.model) ?? "unknown",
      promptTokens: typeof usagePayload?.input_tokens === "number" ? usagePayload.input_tokens : null,
      completionTokens: typeof usagePayload?.output_tokens === "number" ? usagePayload.output_tokens : null,
      totalTokens: typeof usagePayload?.total_tokens === "number" ? usagePayload.total_tokens : null,
      latencyMs: options.latencyMs ?? null,
    },
    latencyMs: options.latencyMs ?? null,
    outputItems: outputSummary.items,
    outputItemsTruncated: outputSummary.truncated,
    errorCode: options.errorCode ?? null,
  }
  const responses = [...receipt.responses, trace]
  return {
    ...receipt,
    supportId: responseId ?? receipt.supportId,
    providerStatus: trace.status ?? receipt.providerStatus,
    responses,
  }
}

export function withWorkspaceExecutionOutcome(
  receipt: WorkspaceExecutionReceipt,
  productStatus: WorkspaceExecutionProductStatus,
): WorkspaceExecutionReceipt {
  return { ...receipt, productStatus }
}

export function mergeWorkspaceExecutionReceipts(
  receipts: Array<WorkspaceExecutionReceipt | null | undefined>,
): WorkspaceExecutionReceipt | null {
  const valid = receipts.filter((receipt): receipt is WorkspaceExecutionReceipt => Boolean(receipt))
  if (valid.length === 0) return null
  const first = valid[0]
  const responses = valid.flatMap((receipt) => receipt.responses)
  const lastResponse = responses.at(-1)
  return {
    ...first,
    supportId: lastResponse?.responseId ?? valid.at(-1)?.supportId ?? first.supportId,
    action: lastResponse?.action ?? first.action,
    stage: lastResponse?.stage ?? first.stage,
    runtime: lastResponse?.runtime ?? first.runtime,
    contextVersion: lastResponse?.contextVersion ?? first.contextVersion,
    providerStatus: lastResponse?.status ?? valid.at(-1)?.providerStatus ?? first.providerStatus,
    productStatus: valid.at(-1)?.productStatus ?? first.productStatus,
    responses,
  }
}
