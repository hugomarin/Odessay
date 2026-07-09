import { describe, expect, it } from "vitest"

import {
  findLogicalStaleCorrectionBlocks,
  parseCorrectionBlockLogicalId,
  parseCorrectionBlockPosition,
} from "@/lib/corrections/block-invalidation"

describe("correction block invalidation helpers", () => {
  it("parses trailing positions from both legacy and logical block ids", () => {
    expect(parseCorrectionBlockPosition("block-123:456")).toBe(456)
    expect(parseCorrectionBlockPosition("correction-block:0.3:blk-old:236")).toBe(236)
  })

  it("returns null for missing or malformed block positions", () => {
    expect(parseCorrectionBlockPosition("block-123")).toBeNull()
    expect(parseCorrectionBlockPosition("correction-block:0.3:blk-old:not-a-number")).toBeNull()
  })

  it("extracts logical ids only from correction block identifiers", () => {
    expect(parseCorrectionBlockLogicalId("correction-block:chapter:1:hash-a:236")).toBe("chapter:1")
    expect(parseCorrectionBlockLogicalId("block-123:456")).toBeNull()
  })

  it("matches stale candidates by shared logical id before falling back to position", () => {
    expect(
      findLogicalStaleCorrectionBlocks(
        [
          { id: "candidate-a", blockId: "correction-block:chapter:1:hash-a:236", blockHash: "hash-a" },
          { id: "candidate-b", blockId: "correction-block:chapter:2:hash-b:236", blockHash: "hash-b" },
        ],
        { id: "correction-block:chapter:1:hash-new:999", hash: "hash-new" },
      ).map((block) => block.id),
    ).toEqual(["candidate-a"])
  })
})
