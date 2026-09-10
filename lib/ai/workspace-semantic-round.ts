import { z } from "zod"
import type {
  WorkspaceSemanticInputItem,
  WorkspaceSemanticRoundRequest,
  WorkspaceSemanticRoundResult,
  WorkspaceSemanticToolDescriptor,
} from "@/lib/services/contracts/ai-service"
import type { WorkspaceExecutionReceipt } from "@/lib/services/contracts/ai-service"
import { workspaceExecutionContextSchema } from "@/lib/ai/workspace-execution-receipt"
import type { WorkspaceOpenAIResponsePayload } from "@/lib/ai/workspace-openai-response"
import {
  getWorkspaceSemanticToolDescriptors,
  isCanonicalWorkspaceSemanticToolDescriptor,
} from "@/lib/ai/workspace-semantic-tool-registry"

export const MAX_WORKSPACE_SEMANTIC_INPUT_ITEMS = 16
export const MAX_WORKSPACE_SEMANTIC_INPUT_ITEM_CHARS = 16_000
export const MAX_WORKSPACE_SEMANTIC_INPUT_BYTES = 65_536
export const MAX_WORKSPACE_SEMANTIC_TOOLS = 4
export const MAX_WORKSPACE_SEMANTIC_OUTPUT_TEXT_CHARS = 32_000

const semanticInputItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(MAX_WORKSPACE_SEMANTIC_INPUT_ITEM_CHARS),
  }).strict(),
  z.object({
    type: z.literal("function_call_output"),
    callId: z.string().trim().min(1).max(128),
    output: z.string().min(1).max(MAX_WORKSPACE_SEMANTIC_INPUT_ITEM_CHARS),
  }).strict(),
])

const semanticToolDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2_000),
  parameters: z.record(z.string(), z.unknown()),
}).strict()

export const workspaceSemanticRoundRequestSchema = z.object({
  operation: z.enum(["relations", "merge"]),
  input: z.array(semanticInputItemSchema).min(1).max(MAX_WORKSPACE_SEMANTIC_INPUT_ITEMS),
  tools: z.array(semanticToolDescriptorSchema).max(MAX_WORKSPACE_SEMANTIC_TOOLS),
  previousResponseId: z.string().trim().max(256).nullable().optional(),
  execution: workspaceExecutionContextSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  const totalChars = value.input.reduce((total, item) => total + (item.type === "message" ? item.content.length : item.output.length), 0)
  if (totalChars > MAX_WORKSPACE_SEMANTIC_INPUT_BYTES) {
    context.addIssue({ code: "custom", path: ["input"], message: "Semantic round input exceeds the bounded context budget." })
  }
  const names = new Set<string>()
  for (const [index, tool] of value.tools.entries()) {
    if (names.has(tool.name)) {
      context.addIssue({ code: "custom", path: ["tools", index, "name"], message: "Semantic tools must be unique." })
    }
    names.add(tool.name)
    if (!isCanonicalWorkspaceSemanticToolDescriptor(tool as WorkspaceSemanticToolDescriptor)) {
      context.addIssue({ code: "custom", path: ["tools", index], message: "Semantic tool is not in the read-only registry." })
    }
  }
})

export const workspaceSemanticRoundResponseSchema = z.object({
  responseId: z.string().nullable(),
  previousResponseId: z.string().nullable(),
  status: z.enum(["completed", "requires_tool", "incomplete", "refused", "empty"]),
  outputText: z.string().nullable(),
  toolCalls: z.array(z.object({
    callId: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }).strict()),
  incompleteReason: z.string().nullable(),
  usage: z.object({
    model: z.string(),
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    latencyMs: z.number().nullable(),
  }).nullable(),
  executionReceipt: z.unknown().nullable(),
}).strict()

export function buildWorkspaceSemanticSystemPrompt(): string {
  return [
    "You are Odessay's bounded semantic workspace reviewer.",
    "Use only the declared read-only evidence tool and only for documents already in the supplied evidence scope.",
    "Never write, edit, move, delete, invent a document id, use a filesystem path, or treat a missing/stale read as evidence.",
    "Request at most the smallest line ranges needed to resolve uncertainty.",
    "When evidence is sufficient, return a JSON object with coverage ('complete', 'partial', or 'unknown'), an explicit status ('complete' or 'insufficient_evidence'), and payload containing the operation result as a JSON-encoded string.",
    "Partial or unknown coverage must never be presented as a definitive no-conflict result.",
  ].join(" ")
}

export function toWorkspaceSemanticProviderInput(input: readonly WorkspaceSemanticInputItem[]): unknown[] {
  return input.map((item) => item.type === "message"
    ? { role: item.role, content: item.content }
    : { type: "function_call_output", call_id: item.callId, output: item.output })
}

export function toWorkspaceSemanticProviderTools(
  tools: readonly WorkspaceSemanticToolDescriptor[],
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }))
}

export class WorkspaceSemanticRoundParseError extends Error {
  readonly code = "AI_RESPONSE_PARSE_FAILED"

  constructor(message: string) {
    super(message)
    this.name = "WorkspaceSemanticRoundParseError"
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function parseArguments(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value) as unknown
        } catch {
          return null
        }
      })()
    : value
  const record = asRecord(parsed)
  if (!record) throw new WorkspaceSemanticRoundParseError("AI returned an invalid semantic tool-call argument object.")
  return record
}

function outputTextFrom(payload: WorkspaceOpenAIResponsePayload): string | null {
  const outputText = payload.output_text
    ?? payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("")
  const text = outputText?.trim() ?? ""
  return text ? text.slice(0, MAX_WORKSPACE_SEMANTIC_OUTPUT_TEXT_CHARS) : null
}

export function normalizeWorkspaceSemanticProviderResponse(
  payload: WorkspaceOpenAIResponsePayload,
  receipt: WorkspaceExecutionReceipt,
  allowedToolNames: readonly string[] = getWorkspaceSemanticToolDescriptors().map((tool) => tool.name),
): WorkspaceSemanticRoundResult {
  const allowedNames = new Set(allowedToolNames)
  const output = Array.isArray(payload.output) ? payload.output : []
  const refusal = output
    .flatMap((item) => item.content ?? [])
    .find((content) => content.type === "refusal")
  if (refusal) {
    return {
      responseId: stringValue(payload.id),
      previousResponseId: stringValue(payload.previous_response_id),
      status: "refused",
      outputText: null,
      toolCalls: [],
      incompleteReason: null,
      usage: receipt.responses.at(-1)?.usage ?? null,
      executionReceipt: receipt,
    }
  }

  if (payload.status === "incomplete") {
    return {
      responseId: stringValue(payload.id),
      previousResponseId: stringValue(payload.previous_response_id),
      status: "incomplete",
      outputText: outputTextFrom(payload),
      toolCalls: [],
      incompleteReason: stringValue(payload.incomplete_details?.reason),
      usage: receipt.responses.at(-1)?.usage ?? null,
      executionReceipt: receipt,
    }
  }

  const toolCalls = output
    .filter((item) => item.type === "function_call")
    .map((item) => {
      const callId = stringValue(item.call_id)
      const name = stringValue(item.name)
      if (!callId || !name || !allowedNames.has(name)) {
        throw new WorkspaceSemanticRoundParseError("AI returned a semantic tool call outside the declared registry.")
      }
      return { callId, name, arguments: parseArguments(item.arguments) }
    })

  return {
    responseId: stringValue(payload.id),
    previousResponseId: stringValue(payload.previous_response_id),
    status: toolCalls.length > 0 ? "requires_tool" : outputTextFrom(payload) ? "completed" : "empty",
    outputText: outputTextFrom(payload),
    toolCalls,
    incompleteReason: null,
    usage: receipt.responses.at(-1)?.usage ?? null,
    executionReceipt: receipt,
  }
}

export type ParsedWorkspaceSemanticRoundRequest = z.infer<typeof workspaceSemanticRoundRequestSchema> & WorkspaceSemanticRoundRequest
