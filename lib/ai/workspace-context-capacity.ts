import type { WorkspaceSemanticInputItem } from "@/lib/services/contracts/ai-service"

export type WorkspaceContextCapacityStatus = "ready" | "staged" | "capacity_unknown" | "budget_exceeded"

/**
 * Context capacity is a deployment/model capability, never a product
 * selection rule. Every named reserve is explicit so callers cannot mistake
 * the physical model window for usable document space.
 */
export type WorkspaceContextCapacity = {
  contextWindowTokens: number | null
  reservedOutputTokens: number
  systemPromptTokens?: number
  schemaAndToolTokens?: number
  historyTokens?: number
  reasoningTokens?: number
  safetyMarginTokens?: number
  /** Additional provider-envelope reserve not covered by the named fields. */
  overheadTokens?: number
}

export type WorkspaceContextBatchPlan = {
  batches: WorkspaceSemanticInputItem[][]
  estimatedInputTokens: number
  availableInputTokens: number | null
  staged: boolean
  status: WorkspaceContextCapacityStatus
}

export class WorkspaceContextCapacityError extends Error {
  constructor(
    readonly code: "CAPACITY_UNKNOWN" | "BUDGET_EXCEEDED",
    message: string,
  ) {
    super(message)
    this.name = "WorkspaceContextCapacityError"
  }
}

function reservedWorkspaceContextTokens(capacity: WorkspaceContextCapacity): number {
  return capacity.reservedOutputTokens
    + (capacity.systemPromptTokens ?? 0)
    + (capacity.schemaAndToolTokens ?? 0)
    + (capacity.historyTokens ?? 0)
    + (capacity.reasoningTokens ?? 0)
    + (capacity.safetyMarginTokens ?? 0)
    + (capacity.overheadTokens ?? 0)
}

export function availableWorkspaceInputTokens(capacity: WorkspaceContextCapacity): number | null {
  return capacity.contextWindowTokens == null
    ? null
    : Math.max(0, capacity.contextWindowTokens - reservedWorkspaceContextTokens(capacity))
}

export function estimateWorkspaceTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

export function estimateWorkspaceInputTokens(input: readonly WorkspaceSemanticInputItem[]): number {
  return input.reduce((total, item) => total + estimateWorkspaceTokens(
    item.type === "message" ? item.content : item.output,
  ), 0)
}

/**
 * Partitions ordered semantic evidence without truncating an item. A source
 * chunk larger than the available capacity is kept intact and reported as a
 * one-item batch; the provider then returns an explicit context error rather
 * than receiving a silently shortened document.
 */
export function planWorkspaceSemanticBatches(
  input: readonly WorkspaceSemanticInputItem[],
  capacity: WorkspaceContextCapacity,
): WorkspaceContextBatchPlan {
  const estimatedInputTokens = estimateWorkspaceInputTokens(input)
  const availableInputTokens = availableWorkspaceInputTokens(capacity)

  if (availableInputTokens === null) {
    return {
      batches: [],
      estimatedInputTokens,
      availableInputTokens,
      staged: false,
      status: "capacity_unknown",
    }
  }

  if (availableInputTokens === 0) {
    return {
      batches: [],
      estimatedInputTokens,
      availableInputTokens,
      staged: false,
      status: "budget_exceeded",
    }
  }

  if (estimatedInputTokens <= availableInputTokens) {
    return {
      batches: [ [...input] ],
      estimatedInputTokens,
      availableInputTokens,
      staged: false,
      status: "ready",
    }
  }

  const batches: WorkspaceSemanticInputItem[][] = []
  let current: WorkspaceSemanticInputItem[] = []
  let currentTokens = 0
  const append = (item: WorkspaceSemanticInputItem) => {
    const itemTokens = estimateWorkspaceTokens(item.type === "message" ? item.content : item.output)
    if (current.length > 0 && currentTokens + itemTokens > availableInputTokens) {
      batches.push(current)
      current = []
      currentTokens = 0
    }
    current.push(item)
    currentTokens += itemTokens
  }

  for (const item of input) {
    const content = item.type === "message" ? item.content : item.output
    const itemTokens = estimateWorkspaceTokens(content)
    if (item.type !== "message" || itemTokens <= availableInputTokens) {
      append(item)
      continue
    }

    // A document/source message can itself be larger than the available
    // request budget. Split that message losslessly before batching; keeping
    // an oversized item intact would turn a large selected `.md` into a
    // provider error even though staged processing could handle it.
    const maxChars = Math.max(1, availableInputTokens * 4)
    for (let offset = 0; offset < content.length; offset += maxChars) {
      append({ type: "message", role: item.role, content: content.slice(offset, offset + maxChars) })
    }
  }
  if (current.length > 0) batches.push(current)

  return { batches, estimatedInputTokens, availableInputTokens, staged: batches.length > 1, status: "staged" }
}

/** Splits a prompt into ordered, lossless text batches for staged Responses calls. */
export function planWorkspaceTextBatches(
  text: string,
  capacity: WorkspaceContextCapacity,
): { batches: string[]; staged: boolean; availableInputTokens: number | null; status: WorkspaceContextCapacityStatus } {
  const availableInputTokens = availableWorkspaceInputTokens(capacity)
  if (availableInputTokens === null) {
    return { batches: [], staged: false, availableInputTokens, status: "capacity_unknown" }
  }
  if (availableInputTokens === 0) {
    return { batches: [], staged: false, availableInputTokens, status: "budget_exceeded" }
  }
  if (estimateWorkspaceTokens(text) <= availableInputTokens) {
    return { batches: [text], staged: false, availableInputTokens, status: "ready" }
  }
  const maxChars = Math.max(1, availableInputTokens * 4)
  const batches: string[] = []
  for (let offset = 0; offset < text.length; offset += maxChars) {
    batches.push(text.slice(offset, offset + maxChars))
  }
  return { batches, staged: batches.length > 1, availableInputTokens, status: "staged" }
}

export function recommendedDocumentTokenBudget(
  capacity: WorkspaceContextCapacity,
  documentCount: number,
): number | null {
  if (capacity.contextWindowTokens == null || documentCount <= 0) return null
  const available = Math.max(0, capacity.contextWindowTokens - reservedWorkspaceContextTokens(capacity))
  return Math.floor(available / documentCount)
}

export function assertWorkspaceContextPlanCapacity(
  plan: Pick<WorkspaceContextBatchPlan, "status"> | { status: WorkspaceContextCapacityStatus },
): void {
  if (plan.status === "capacity_unknown") {
    throw new WorkspaceContextCapacityError(
      "CAPACITY_UNKNOWN",
      "Workspace context capacity is unknown for the configured model. Configure OPENAI_WORKSPACE_CONTEXT_WINDOW_TOKENS or use a registered model.",
    )
  }
  if (plan.status === "budget_exceeded") {
    throw new WorkspaceContextCapacityError(
      "BUDGET_EXCEEDED",
      "Workspace context reserves leave no capacity for selected evidence. Reduce the configured reserves or use a larger model window.",
    )
  }
}
