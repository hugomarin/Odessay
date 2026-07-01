import type { CorrectionTriggerBlock } from "@/lib/editor/correction-trigger-plugin"

export const isCorrectionBlockEligible = (block: Pick<CorrectionTriggerBlock, "text">) =>
  block.text.trim().length > 0

export const getHydrateMissCorrectionBlocks = (
  blocks: CorrectionTriggerBlock[],
  cachedBlockHashes: Set<string>,
) => blocks.filter((block) => isCorrectionBlockEligible(block) && !cachedBlockHashes.has(block.hash))
