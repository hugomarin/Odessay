import { describe, expect, it } from "vitest"

import {
  CORRECTION_STALE_TIMEOUT_MS,
  consumeDeferredCorrectionBlocks,
  deferCorrectionBlocks,
  dropExpiredStaleSuggestions,
  dropStaleSuggestionsForBlock,
  restorePendingSuggestions,
} from "@/lib/corrections/engine/lifecycle"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

const makeSuggestion = (
  override: Partial<PublicationSuggestion> = {},
): PublicationSuggestion => ({
  id: "suggestion-1",
  kind: "spelling",
  mechanical_type: "spelling",
  title: "Spelling",
  reason: "Typo",
  original_text: "Prueva",
  replacement_text: "Prueba",
  block_id: "correction-block:0:old-hash:12",
  source_hash: "old-hash",
  correction_fingerprint: "spelling|prueva|prueba",
  status: "pending-stale",
  staleSince: 1_000,
  ...override,
})

describe("corrections lifecycle", () => {
  it("drops stale suggestions for a failed block analysis", () => {
    const result = dropStaleSuggestionsForBlock([
      makeSuggestion(),
      makeSuggestion({ id: "other", block_id: "correction-block:1:old-hash:24" }),
    ], "correction-block:0:new-hash:12")

    expect(result.droppedIds).toEqual(["suggestion-1"])
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual(["other"])
  })

  it("drops pending-stale suggestions after the timeout", () => {
    const result = dropExpiredStaleSuggestions([
      makeSuggestion(),
      makeSuggestion({ id: "fresh", staleSince: 10_999 }),
    ], 1_000 + CORRECTION_STALE_TIMEOUT_MS)

    expect(result.droppedIds).toEqual(["suggestion-1"])
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual(["fresh"])
  })

  it("restores cached suggestions to pending before cache-hit re-admission", () => {
    expect(restorePendingSuggestions([makeSuggestion()])).toEqual([
      expect.objectContaining({
        id: "suggestion-1",
        status: "pending",
      }),
    ])
    expect(restorePendingSuggestions([makeSuggestion()])[0]).not.toHaveProperty("staleSince")
  })

  it("defers dirty blocks during suppression and keeps the latest block per id", () => {
    const first = deferCorrectionBlocks({ blocksById: new Map(), flushAt: null }, [
      { id: "block-1", hash: "hash-a" },
    ], 1_200)
    const second = deferCorrectionBlocks(first, [
      { id: "block-1", hash: "hash-b" },
      { id: "block-2", hash: "hash-c" },
    ], 1_100)
    const consumed = consumeDeferredCorrectionBlocks(second)

    expect(second.flushAt).toBe(1_100)
    expect(consumed.blocks).toEqual([
      { id: "block-1", hash: "hash-b" },
      { id: "block-2", hash: "hash-c" },
    ])
    expect(consumed.state.blocksById.size).toBe(0)
    expect(consumed.state.flushAt).toBeNull()
  })
})
