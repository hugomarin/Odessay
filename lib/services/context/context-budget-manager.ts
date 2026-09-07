import type { ContextBudget } from "@/lib/services/context/types"

/**
 * Application-layer budget enforcement (odessay-agent-context-cache.md
 * "Presupuesto"). Tracks tokens, documents and bytes consumed against a
 * ContextBudget so acquisition stops at a controlled point instead of
 * reading the whole Workspace.
 */
export type ContextBudgetManager = {
  /** Whether adding one more source of this size would still fit the budget. */
  canAdd(byteCount: number, tokenCount: number): boolean
  add(byteCount: number, tokenCount: number): void
  /** Consumes one retrieval round; returns false when no rounds remain. */
  useRetrievalRound(): boolean
  isExhausted(): boolean
  snapshot(): { tokens: number; documents: number; bytes: number; rounds: number }
}

export function createContextBudgetManager(budget: ContextBudget): ContextBudgetManager {
  let tokens = 0
  let documents = 0
  let bytes = 0
  let rounds = 0

  return {
    canAdd(byteCount, tokenCount) {
      return documents < budget.maxDocuments
        && bytes + byteCount <= budget.maxBytes
        && tokens + tokenCount <= budget.maxInputTokens
    },
    add(byteCount, tokenCount) {
      bytes += byteCount
      tokens += tokenCount
      documents += 1
    },
    useRetrievalRound() {
      if (rounds >= budget.maxRetrievalRounds) return false
      rounds += 1
      return true
    },
    isExhausted() {
      return documents >= budget.maxDocuments || bytes >= budget.maxBytes || tokens >= budget.maxInputTokens
    },
    snapshot() {
      return { tokens, documents, bytes, rounds }
    },
  }
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}
