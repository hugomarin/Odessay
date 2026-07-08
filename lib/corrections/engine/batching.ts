import { CORRECTION_BLOCK_BATCH_SIZE } from "@/lib/ai/corrections-config";
import type { CorrectionBlockInput } from "@/lib/services/contracts/ai-service";

type CorrectionLike = {
  blockId: string;
};

export const takeCorrectionBatch = <T extends CorrectionBlockInput>(
  queue: T[],
  batchSize = CORRECTION_BLOCK_BATCH_SIZE,
) => queue.splice(0, batchSize);

export const getMissingCorrectionBlockIds = (
  sentBlocks: ReadonlyArray<CorrectionBlockInput>,
  receivedCorrections: ReadonlyArray<CorrectionLike>,
) => {
  if (receivedCorrections.length === 0) {
    return [];
  }

  const receivedIds = new Set(receivedCorrections.map((correction) => correction.blockId));
  return sentBlocks
    .map((block) => block.id)
    .filter((blockId) => !receivedIds.has(blockId));
};

export const groupCorrectionsByBlockId = <T extends CorrectionLike>(corrections: ReadonlyArray<T>) => {
  const grouped = new Map<string, T[]>();

  for (const correction of corrections) {
    const items = grouped.get(correction.blockId) ?? [];
    items.push(correction);
    grouped.set(correction.blockId, items);
  }

  return grouped;
};
