import type { WorkspaceSemanticInputItem } from "@/lib/services/contracts/ai-service"

/**
 * Context capacity is a deployment/model capability, never a product
 * selection rule. When the capability is unknown we leave the provider in
 * charge instead of guessing a window and dropping user-selected content.
 */
export type WorkspaceContextCapacity = {
  contextWindowTokens: number | null
  reservedOutputTokens: number
  overheadTokens?: number
}

export type WorkspaceContextBatchPlan = {
  batches: WorkspaceSemanticInputItem[][]
  estimatedInputTokens: number
  availableInputTokens: number | null
  staged: boolean
}

export function availableWorkspaceInputTokens(capacity: WorkspaceContextCapacity): number | null {
  return capacity.contextWindowTokens == null
    ? null
    : Math.max(1, capacity.contextWindowTokens - capacity.reservedOutputTokens - (capacity.overheadTokens ?? 0))
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

  if (availableInputTokens === null || estimatedInputTokens <= availableInputTokens) {
    return {
      batches: [ [...input] ],
      estimatedInputTokens,
      availableInputTokens,
      staged: false,
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

  return { batches, estimatedInputTokens, availableInputTokens, staged: batches.length > 1 }
}

/** Splits a prompt into ordered, lossless text batches for staged Responses calls. */
export function planWorkspaceTextBatches(
  text: string,
  capacity: WorkspaceContextCapacity,
): { batches: string[]; staged: boolean; availableInputTokens: number | null } {
  const availableInputTokens = availableWorkspaceInputTokens(capacity)
  if (availableInputTokens === null || estimateWorkspaceTokens(text) <= availableInputTokens) {
    return { batches: [text], staged: false, availableInputTokens }
  }
  const maxChars = Math.max(1, availableInputTokens * 4)
  const batches: string[] = []
  for (let offset = 0; offset < text.length; offset += maxChars) {
    batches.push(text.slice(offset, offset + maxChars))
  }
  return { batches, staged: batches.length > 1, availableInputTokens }
}

export function recommendedDocumentTokenBudget(
  capacity: WorkspaceContextCapacity,
  documentCount: number,
): number | null {
  if (capacity.contextWindowTokens == null || documentCount <= 0) return null
  const available = Math.max(0, capacity.contextWindowTokens - capacity.reservedOutputTokens - (capacity.overheadTokens ?? 0))
  return Math.floor(available / documentCount)
}
