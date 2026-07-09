import type { PublicationSuggestion } from "@/lib/local-db/schema"
import {
  parseCorrectionBlockLogicalId,
  parseCorrectionBlockPosition,
} from "@/lib/corrections/block-invalidation"

export const CORRECTION_STALE_TIMEOUT_MS = 10_000

type BlockIdentity = {
  id: string
}

export type StaleTransitionResult = {
  suggestions: PublicationSuggestion[]
  droppedIds: string[]
}

export type DeferredCorrectionBlocksState<TBlock extends BlockIdentity> = {
  blocksById: Map<string, TBlock>
  flushAt: number | null
}

export const isSameCorrectionBlock = (
  suggestionBlockId: string | null | undefined,
  blockId: string,
): boolean => {
  if (!suggestionBlockId) return false
  if (suggestionBlockId === blockId) return true

  const suggestionLogicalId = parseCorrectionBlockLogicalId(suggestionBlockId)
  const blockLogicalId = parseCorrectionBlockLogicalId(blockId)

  if (suggestionLogicalId && blockLogicalId) {
    return suggestionLogicalId === blockLogicalId
  }

  const suggestionPos = parseCorrectionBlockPosition(suggestionBlockId)
  const blockPos = parseCorrectionBlockPosition(blockId)
  return suggestionPos !== null && blockPos !== null && suggestionPos === blockPos
}

export const markSuggestionStale = (
  suggestion: PublicationSuggestion,
  staleSince: number,
): PublicationSuggestion => ({
  ...suggestion,
  status: "pending-stale",
  staleSince,
})

export const restoreSuggestionPending = (
  suggestion: PublicationSuggestion,
): PublicationSuggestion => {
  const nextSuggestion = { ...suggestion }
  delete nextSuggestion.staleSince

  return {
    ...nextSuggestion,
    status: "pending",
  }
}

export const restorePendingSuggestions = (
  suggestions: PublicationSuggestion[],
): PublicationSuggestion[] => suggestions.map(restoreSuggestionPending)

export const dropStaleSuggestionsForBlock = (
  suggestions: PublicationSuggestion[],
  blockId: string,
): StaleTransitionResult => {
  const droppedIds: string[] = []
  const nextSuggestions = suggestions.filter((suggestion) => {
    if (suggestion.status === "pending-stale" && isSameCorrectionBlock(suggestion.block_id, blockId)) {
      droppedIds.push(suggestion.id)
      return false
    }

    return true
  })

  return { suggestions: nextSuggestions, droppedIds }
}

export const dropExpiredStaleSuggestions = (
  suggestions: PublicationSuggestion[],
  now: number,
  timeoutMs = CORRECTION_STALE_TIMEOUT_MS,
): StaleTransitionResult => {
  const droppedIds: string[] = []
  const nextSuggestions = suggestions.filter((suggestion) => {
    if (
      suggestion.status === "pending-stale" &&
      typeof suggestion.staleSince === "number" &&
      now - suggestion.staleSince >= timeoutMs
    ) {
      droppedIds.push(suggestion.id)
      return false
    }

    return true
  })

  return { suggestions: nextSuggestions, droppedIds }
}

export const deferCorrectionBlocks = <TBlock extends BlockIdentity>(
  state: DeferredCorrectionBlocksState<TBlock>,
  blocks: TBlock[],
  flushAt: number,
): DeferredCorrectionBlocksState<TBlock> => {
  const blocksById = new Map(state.blocksById)

  for (const block of blocks) {
    blocksById.set(block.id, block)
  }

  return {
    blocksById,
    flushAt: state.flushAt === null ? flushAt : Math.min(state.flushAt, flushAt),
  }
}

export const consumeDeferredCorrectionBlocks = <TBlock extends BlockIdentity>(
  state: DeferredCorrectionBlocksState<TBlock>,
): { blocks: TBlock[]; state: DeferredCorrectionBlocksState<TBlock> } => ({
  blocks: [...state.blocksById.values()],
  state: {
    blocksById: new Map(),
    flushAt: null,
  },
})
