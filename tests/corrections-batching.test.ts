import { describe, expect, it } from "vitest";
import {
  CORRECTION_BLOCK_BATCH_SIZE,
  CORRECTION_PACKAGE_MAX_BLOCKS,
  CORRECTION_PACKAGE_MAX_BLOCK_CHARS,
  CORRECTION_PACKAGE_MAX_CHARS,
  CORRECTION_PACKAGE_MAX_INPUT_TOKENS,
} from "@/lib/ai/corrections-config";
import {
  getMissingCorrectionBlockIds,
  groupCorrectionsByBlockId,
  takeCorrectionBatch,
} from "@/lib/corrections/engine/batching";
import { packageCorrectionBlocks } from "@/lib/corrections/engine/packaging";
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

  it("packs a representative 100-paragraph writing into bounded provider requests", () => {
    const fixture = Array.from({ length: 100 }, (_, index) => ({
      id: `correction-block:${index}:hash-${index}:${index * 300}`,
      text: `Párrafo ${index + 1}. ${"Texto representativo en español para medir el paquete de correcciones. ".repeat(4)}`,
      hash: `hash-${index}`,
    }));

    const result = packageCorrectionBlocks(fixture);

    expect(result.skippedBlocks).toEqual([]);
    expect(result.packages.length).toBeGreaterThanOrEqual(5);
    expect(result.packages.length).toBeLessThanOrEqual(6);
    expect(result.packages.flatMap((pkg) => pkg.blocks)).toEqual(fixture);

    for (const pkg of result.packages) {
      const bodyChars = pkg.blocks.reduce((sum, block) => sum + block.text.length + block.id.length + 32, 0);
      expect(pkg.blocks.length).toBeLessThanOrEqual(CORRECTION_PACKAGE_MAX_BLOCKS);
      expect(bodyChars).toBeLessThanOrEqual(CORRECTION_PACKAGE_MAX_CHARS);
      expect(pkg.estimatedInputTokens).toBeLessThanOrEqual(CORRECTION_PACKAGE_MAX_INPUT_TOKENS);
    }
  });

  it("skips an oversized individual block deterministically without affecting valid siblings", () => {
    const oversized = {
      id: "oversized",
      text: "x".repeat(CORRECTION_PACKAGE_MAX_BLOCK_CHARS + 1),
      hash: "hash-oversized",
    };
    const valid = { id: "valid", text: "Texto válido.", hash: "hash-valid" };

    const result = packageCorrectionBlocks([oversized, valid]);

    expect(result.skippedBlocks).toEqual([oversized]);
    expect(result.skippedReasons.get(oversized.id)).toContain("block exceeds max characters");
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.blocks).toEqual([valid]);
  });

  it("skips a block whose identifier alone would exceed the package budget", () => {
    const oversizedId = {
      id: "x".repeat(CORRECTION_PACKAGE_MAX_CHARS + 1),
      text: "Texto corto.",
      hash: "hash-long-id",
    };

    const result = packageCorrectionBlocks([oversizedId]);

    expect(result.packages).toEqual([]);
    expect(result.skippedBlocks).toEqual([oversizedId]);
    expect(result.skippedReasons.get(oversizedId.id)).toContain("block exceeds package budget");
  });
});
