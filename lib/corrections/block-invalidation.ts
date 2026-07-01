export const DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW = 8

export type PersistedCorrectionBlockIdentity = {
  id: string
  blockId: string
  blockHash: string
}

export type CurrentCorrectionBlockIdentity = {
  id: string
  hash: string
  pos?: number | null
}

const CORRECTION_BLOCK_PREFIX = "correction-block"

const splitCorrectionBlockId = (blockId: string) => blockId.split(":")

export const parseCorrectionBlockPosition = (blockId: string) => {
  const parts = splitCorrectionBlockId(blockId)
  const rawPosition = parts.at(-1)
  const position = rawPosition ? Number.parseInt(rawPosition, 10) : Number.NaN
  return Number.isFinite(position) ? position : null
}

export const parseCorrectionBlockLogicalId = (blockId: string) => {
  const parts = splitCorrectionBlockId(blockId)

  if (parts[0] !== CORRECTION_BLOCK_PREFIX || parts.length < 4) {
    return null
  }

  const logicalId = parts.slice(1, -2).join(":").trim()
  return logicalId.length > 0 ? logicalId : null
}

const matchesLogicalBlock = (
  candidate: PersistedCorrectionBlockIdentity,
  current: CurrentCorrectionBlockIdentity,
  positionWindow: number,
) => {
  const candidateLogicalId = parseCorrectionBlockLogicalId(candidate.blockId)
  const currentLogicalId = parseCorrectionBlockLogicalId(current.id)

  if (candidateLogicalId && currentLogicalId) {
    return candidateLogicalId === currentLogicalId
  }

  const candidatePosition = parseCorrectionBlockPosition(candidate.blockId)
  const currentPosition = current.pos ?? parseCorrectionBlockPosition(current.id)

  if (candidatePosition === null || currentPosition === null) {
    return false
  }

  return Math.abs(candidatePosition - currentPosition) <= positionWindow
}

export const findLogicalStaleCorrectionBlocks = (
  candidates: PersistedCorrectionBlockIdentity[],
  current: CurrentCorrectionBlockIdentity,
  positionWindow = DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
) =>
  candidates.filter(
    (candidate) =>
      candidate.blockHash !== current.hash && matchesLogicalBlock(candidate, current, positionWindow),
  )

export const partitionHydratedCorrectionBlocks = <
  T extends {
    blockHash: string
  },
>(
  blocks: T[],
  currentBlockHashes: Iterable<string>,
) => {
  const currentHashes = new Set(currentBlockHashes)
  const fresh: T[] = []
  const stale: T[] = []

  for (const block of blocks) {
    if (currentHashes.has(block.blockHash)) {
      fresh.push(block)
      continue
    }

    stale.push(block)
  }

  return { fresh, stale }
}
