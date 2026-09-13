import type { AiUsage } from "@/lib/services/contracts/ai-service"
import type { WorkspaceExecutionReceipt } from "@/lib/ai/workspace-execution-receipt"
import type {
  WorkspaceSemanticCoverage,
  WorkspaceSemanticLoopError,
  WorkspaceSemanticLoopStatus,
} from "@/lib/ai/workspace-semantic-loop"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function digest(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function parseJson(text: string): unknown | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const parsed = JSON.parse((fenced ?? text).trim()) as unknown
    if (isRecord(parsed) && typeof parsed.payload === "string") {
      return JSON.parse(parsed.payload) as unknown
    }
    return parsed
  } catch {
    return null
  }
}

export function usageFromReceipt(receipt: WorkspaceExecutionReceipt | null): AiUsage | null {
  if (!receipt || receipt.responses.length === 0) return null
  const responses = receipt.responses
  const sum = (key: "promptTokens" | "completionTokens" | "totalTokens"): number | null => {
    const values = responses.map((response) => response.usage[key]).filter((value): value is number => typeof value === "number")
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
  }
  const latency = responses.map((response) => response.latencyMs).filter((value): value is number => typeof value === "number")
  return {
    model: responses.at(-1)?.model ?? "unknown",
    promptTokens: sum("promptTokens"),
    completionTokens: sum("completionTokens"),
    totalTokens: sum("totalTokens"),
    latencyMs: latency.length > 0 ? latency.reduce((total, value) => total + value, 0) : null,
  }
}

export function invalidOutput(message: string): WorkspaceSemanticLoopError {
  return { code: "AI_RESPONSE_PARSE_FAILED", message, retryable: true }
}

export function conservativeCoverage(
  loopCoverage: WorkspaceSemanticCoverage,
  payloadCoverage: WorkspaceSemanticCoverage,
  invalidItemCount: number,
): WorkspaceSemanticCoverage {
  if (loopCoverage === "unknown" || payloadCoverage === "unknown") return "unknown"
  if (loopCoverage === "partial" || payloadCoverage === "partial" || invalidItemCount > 0) return "partial"
  return "complete"
}

export function statusAfterValidation(
  loopStatus: WorkspaceSemanticLoopStatus,
  coverage: WorkspaceSemanticCoverage,
  invalidItemCount: number,
): WorkspaceSemanticLoopStatus {
  if (loopStatus !== "complete") return loopStatus
  return coverage === "complete" && invalidItemCount === 0 ? "complete" : "insufficient_evidence"
}
