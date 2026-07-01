import { describe, expect, it } from "vitest"
import { getHydrateMissCorrectionBlocks, isCorrectionBlockEligible } from "@/lib/editor/correction-analysis"
import type { CorrectionTriggerBlock } from "@/lib/editor/correction-trigger-plugin"

const createBlock = (overrides: Partial<CorrectionTriggerBlock> = {}): CorrectionTriggerBlock => ({
  id: "correction-block:blk-1:12",
  pos: 12,
  nodeSize: 8,
  nodeType: "paragraph",
  text: "Solo asi",
  hash: "blk-1",
  wordCount: 2,
  ...overrides,
})

describe("correction analysis eligibility", () => {
  it("treats short non-empty blocks as eligible", () => {
    expect(isCorrectionBlockEligible(createBlock())).toBe(true)
    expect(isCorrectionBlockEligible(createBlock({ text: "Tendremos una buen producto." }))).toBe(true)
  })

  it("rejects empty or whitespace-only blocks", () => {
    expect(isCorrectionBlockEligible(createBlock({ text: "" }))).toBe(false)
    expect(isCorrectionBlockEligible(createBlock({ text: "   " }))).toBe(false)
  })

  it("hydrates only uncached eligible blocks", () => {
    const shortBlock = createBlock()
    const cachedBlock = createBlock({ id: "correction-block:blk-2:24", pos: 24, hash: "blk-2", text: "Ya cacheado" })
    const whitespaceBlock = createBlock({
      id: "correction-block:blk-3:36",
      pos: 36,
      hash: "blk-3",
      text: "   ",
      wordCount: 0,
    })

    expect(getHydrateMissCorrectionBlocks([shortBlock, cachedBlock, whitespaceBlock], new Set(["blk-2"]))).toEqual([
      shortBlock,
    ])
  })
})
