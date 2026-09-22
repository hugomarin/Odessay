import type { ContextLedgerEntry } from "@/lib/services/context/types"

/**
 * Records what context was actually consumed for a turn (Context Ledger —
 * odessay-agent-context-cache.md "Ledger de consumo"): which source, which
 * document version, whether it was a cache hit, and how many tokens it
 * implied. Append-only for the lifetime of the store the caller creates.
 */
export type ContextLedger = {
  record(entry: ContextLedgerEntry): void
  entries(): readonly ContextLedgerEntry[]
  clear(): void
}

export function createContextLedger(): ContextLedger {
  const entries: ContextLedgerEntry[] = []

  return {
    record(entry) {
      entries.push(entry)
    },
    entries() {
      return entries
    },
    clear() {
      entries.length = 0
    },
  }
}
