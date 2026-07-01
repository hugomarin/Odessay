import { describe, expect, it } from "vitest"
import {
  findStaleCorrectionBlockRecords,
  reconcileHydratedCorrectionBlocks,
} from "@/lib/corrections/persistence"
import type { LocalCorrectionBlock } from "@/lib/local-db/schema"

const createPersistedBlock = (overrides: Partial<LocalCorrectionBlock>): LocalCorrectionBlock => ({
  id: "auto-correction:writing-1:blk-old",
  writingId: "writing-1",
  blockId: "correction-block:0.3:blk-old:236",
  blockHash: "blk-old",
  suggestions: [
    {
      id: "accepted-old",
      kind: "spelling",
      title: "Spelling",
      reason: "Typo",
      original_text: "aplicació",
      replacement_text: "aplicación",
      context_before: null,
      context_after: null,
      occurrence: 0,
      block_id: "correction-block:0.3:blk-old:236",
      source_hash: "blk-old",
      correction_fingerprint: "accepted-old",
      status: "accepted",
    },
  ],
  model: "test-model",
  createdAt: "2026-07-01T00:00:00.000Z",
  latencyMs: null,
  promptTokens: null,
  completionTokens: null,
  syncedAt: "2026-07-01T00:00:01.000Z",
  ...overrides,
})

describe("editor correction hydration regression", () => {
  it("drops stale accepted blocks after a manual edit changes the block hash", () => {
    const reconciled = reconcileHydratedCorrectionBlocks(
      [
        createPersistedBlock({}),
        createPersistedBlock({
          id: "auto-correction:writing-1:blk-current",
          blockId: "correction-block:0.4:blk-current:245",
          blockHash: "blk-current",
          suggestions: [],
        }),
      ],
      ["blk-current"],
    )

    expect(reconciled.fresh.map((block) => block.id)).toEqual(["auto-correction:writing-1:blk-current"])
    expect(reconciled.stale.map((block) => block.id)).toEqual(["auto-correction:writing-1:blk-old"])
  })

  it("marks the previous logical version for deletion even when the paragraph shifts by one position", () => {
    const staleBlocks = findStaleCorrectionBlockRecords(
      [
        {
          id: "auto-correction:writing-1:blk-old",
          blockId: "correction-block:0.3:blk-old:236",
          blockHash: "blk-old",
        },
      ],
      {
        id: "correction-block:0.3:blk-new:237",
        hash: "blk-new",
        pos: 237,
      },
    )

    expect(staleBlocks.map((block) => block.id)).toEqual(["auto-correction:writing-1:blk-old"])
  })
})
