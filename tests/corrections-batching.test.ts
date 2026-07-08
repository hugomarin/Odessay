import { describe, expect, it } from "vitest";
import { CORRECTION_BLOCK_BATCH_SIZE } from "@/lib/ai/corrections-config";
import {
  getMissingCorrectionBlockIds,
  groupCorrectionsByBlockId,
  takeCorrectionBatch,
} from "@/lib/corrections/engine/batching";
import type { CorrectionBlockInput } from "@/lib/services/contracts/ai-service";

const blocks = (count: number): CorrectionBlockInput[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `block-${index + 1}`,
    text: `Texto ${index + 1}`,
    hash: `hash-${index + 1}`,
  }));

describe("correction batching", () => {
  it("takes at most the configured batch size from the queue", () => {
    const queue = blocks(15);
    const batches = [];

    while (queue.length > 0) {
      batches.push(takeCorrectionBatch(queue).map((block) => block.id));
    }

    expect(CORRECTION_BLOCK_BATCH_SIZE).toBe(5);
    expect(batches).toEqual([
      ["block-1", "block-2", "block-3", "block-4", "block-5"],
      ["block-6", "block-7", "block-8", "block-9", "block-10"],
      ["block-11", "block-12", "block-13", "block-14", "block-15"],
    ]);
  });

  it("detects only omitted block ids when a batch response is partial", () => {
    expect(getMissingCorrectionBlockIds(blocks(3), [
      { blockId: "block-1" },
      { blockId: "block-3" },
    ])).toEqual(["block-2"]);
  });

  it("does not treat an empty correction list as a partial miss", () => {
    expect(getMissingCorrectionBlockIds(blocks(3), [])).toEqual([]);
  });

  it("groups model corrections by returned block id", () => {
    const grouped = groupCorrectionsByBlockId([
      { blockId: "block-2", replacementText: "dos" },
      { blockId: "block-1", replacementText: "uno" },
      { blockId: "block-2", replacementText: "tambien dos" },
    ]);

    expect(grouped.get("block-1")).toEqual([{ blockId: "block-1", replacementText: "uno" }]);
    expect(grouped.get("block-2")).toHaveLength(2);
  });
});
