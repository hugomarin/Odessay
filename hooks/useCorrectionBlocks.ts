"use client"

/**
 * Estado de sugerencias de corrección, su admisión y la caché de bloques de
 * corrección del documento activo del editor.
 *
 * ODE-586 — corte 2 de `components/editor/editor-shell.tsx`, primera mitad.
 * Es una MUDANZA MECÁNICA, como ODE-562 con la hidratación: los cuerpos son
 * los que vivían en la shell, con las mismas dependencias. La propiedad del
 * estado NO cambia: `automaticCorrectionSuggestions` y los refs
 * (`persistedCorrectionBlocksRef`, `editorInstanceRef`, `learnedWordsRef`)
 * siguen siendo de la shell y llegan aquí por `input`.
 *
 * Reglas del corte:
 * - Los refs llegan como `RefObject`, nunca como snapshot de `.current`: los
 *   callbacks diferidos (promesas) leen el valor vivo por ellos.
 * - Las dependencias son las de la shell más esos refs y el setter, que
 *   ahora llegan por `input`. Son identidades estables (`useRef` y el setter
 *   de `useState` de la shell), así que la memoización no cambia.
 * - Sin efectos: aquí solo hay `useMemo`/`useCallback`, así que moverlo no
 *   cambia el orden de los efectos de la shell.
 * - La caché local de bloques se lee y escribe por su dueño canónico,
 *   `lib/corrections/persistence.ts` (regla `ui-no-direct-persistence`).
 */
import { useCallback, useMemo } from "react"
import type { Editor } from "@tiptap/react"

import { admitSuggestions, type AdmissionContext } from "@/lib/corrections/engine/admission"
import { stableFingerprintFromStoredFingerprint } from "@/lib/corrections/engine/identity"
import { createLearnedWordSet } from "@/lib/corrections/learned-words"
import {
  createCorrectionBlockRecordId,
  DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
  deleteLocalCorrectionBlocks,
  findStaleCorrectionBlockRecords,
  parseCorrectionBlockLogicalId,
  persistCorrectionBlockRemotely,
  readLocalCorrectionBlocks,
  saveLocalCorrectionBlock,
} from "@/lib/corrections/persistence"
import { readCorrectionMemory } from "@/lib/editor/correction-memory-client"
import { createCorrectionSuggestionBatcher } from "@/lib/editor/correction-suggestion-batcher"
import { collectCorrectionBlocks, type CorrectionTriggerBlock } from "@/lib/editor/correction-trigger-plugin"
import type { HydrationGeneration } from "@/lib/editor/hydration-generation"
import type { LocalCorrectionBlock, PublicationSuggestion } from "@/lib/local-db/schema"
import type { LearnedWordEntry } from "@/lib/services/contracts/ai-service"

export type CorrectionBlocksInput = {
  setAutomaticCorrectionSuggestions: React.Dispatch<React.SetStateAction<PublicationSuggestion[]>>
  editorInstanceRef: React.RefObject<Editor | null>
  learnedWordsRef: React.RefObject<LearnedWordEntry[]>
  persistedCorrectionBlocksRef: React.RefObject<Map<string, LocalCorrectionBlock>>
}

export function useCorrectionBlocks(input: CorrectionBlocksInput) {
  const { setAutomaticCorrectionSuggestions, editorInstanceRef, learnedWordsRef, persistedCorrectionBlocksRef } = input

  const correctionSuggestionBatcher = useMemo(
    () => createCorrectionSuggestionBatcher(setAutomaticCorrectionSuggestions),
    [setAutomaticCorrectionSuggestions],
  )

  const applyCorrectionSuggestionUpdate = useCallback(
    (
      updater: (current: PublicationSuggestion[]) => PublicationSuggestion[],
      options?: { immediate?: boolean },
    ) => {
      if (options?.immediate) {
        correctionSuggestionBatcher.flush()
        setAutomaticCorrectionSuggestions(updater)
        return
      }

      correctionSuggestionBatcher.enqueue(updater)
    },
    [correctionSuggestionBatcher, setAutomaticCorrectionSuggestions],
  )

  const setPersistedCorrectionBlocks = useCallback((blocks: LocalCorrectionBlock[]) => {
    persistedCorrectionBlocksRef.current = new Map(
      blocks.map((block) => [block.blockHash, block] satisfies [string, LocalCorrectionBlock]),
    )
  }, [persistedCorrectionBlocksRef])

  const flattenPersistedSuggestions = useCallback((blocks: LocalCorrectionBlock[]) => {
    const suggestionsById = new Map<string, PublicationSuggestion>()

    for (const block of blocks) {
      for (const suggestion of block.suggestions) {
        suggestionsById.set(suggestion.id, suggestion)
      }
    }

    return [...suggestionsById.values()]
  }, [])

  const createCorrectionAdmissionContext = useCallback(
    (blocks?: CorrectionTriggerBlock[]): AdmissionContext => {
      const editorBlocks = blocks ?? (editorInstanceRef.current ? collectCorrectionBlocks(editorInstanceRef.current.state.doc) : [])
      const blocksById = new Map(editorBlocks.map((block) => [block.id, block]))
      const blocksByLogicalId = new Map(
        editorBlocks
          .map((block) => [parseCorrectionBlockLogicalId(block.id), block] as const)
          .filter((entry): entry is [string, CorrectionTriggerBlock] => entry[0] !== null),
      )
      const rejectedFingerprints = new Set(
        readCorrectionMemory()
          .filter((entry) => entry.decision === "rejected")
          .map((entry) => stableFingerprintFromStoredFingerprint(entry.fingerprint))
          .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
      )

      return {
        learnedWords: createLearnedWordSet(learnedWordsRef.current.map((item) => item.word)),
        rejectedFingerprints,
        blockText: (blockId) => {
          const block = blocksById.get(blockId)

          if (block) {
            return block.text
          }

          const logicalId = parseCorrectionBlockLogicalId(blockId)
          return logicalId ? blocksByLogicalId.get(logicalId)?.text ?? null : null
        },
      }
    },
    [editorInstanceRef, learnedWordsRef],
  )

  const admitCorrectionSuggestions = useCallback(
    (candidates: PublicationSuggestion[], blocks?: CorrectionTriggerBlock[]) =>
      admitSuggestions(candidates, createCorrectionAdmissionContext(blocks)),
    [createCorrectionAdmissionContext],
  )

  const syncPersistedCorrectionBlock = useCallback(async (block: LocalCorrectionBlock) => {
    persistedCorrectionBlocksRef.current.set(block.blockHash, block)
    await saveLocalCorrectionBlock(block)
  }, [persistedCorrectionBlocksRef])

  const persistCorrectionBlockWriteThrough = useCallback(
    async (block: LocalCorrectionBlock, deletedBlockIds: string[] = []) => {
      await syncPersistedCorrectionBlock(block)

      void persistCorrectionBlockRemotely({
        writingId: block.writingId,
        block,
        deletedBlockIds,
      })
        .then(() => {
          persistedCorrectionBlocksRef.current.set(block.blockHash, {
            ...block,
            syncedAt: new Date().toISOString(),
          })
        })
        .catch((error) => {
          console.info(
            `[corrections] persist skipped message=${error instanceof Error ? error.message : String(error)}`,
          )
        })
    },
    [persistedCorrectionBlocksRef, syncPersistedCorrectionBlock],
  )

  const updatePersistedBlocksFromSuggestions = useCallback(
    async (nextSuggestions: PublicationSuggestion[], blockHashes: string[]) => {
      const currentEditor = editorInstanceRef.current

      if (!currentEditor) {
        return
      }

      const currentBlocksByLogicalId = new Map(
        collectCorrectionBlocks(currentEditor.state.doc)
          .map((block) => [parseCorrectionBlockLogicalId(block.id), block] as const)
          .filter((entry): entry is [string, CorrectionTriggerBlock] => entry[0] !== null),
      )

      const updates = blockHashes
        .map((blockHash) => {
          const persistedBlock = persistedCorrectionBlocksRef.current.get(blockHash)

          if (!persistedBlock) {
            return null
          }

          const logicalId = parseCorrectionBlockLogicalId(persistedBlock.blockId)
          const currentBlock = logicalId ? currentBlocksByLogicalId.get(logicalId) ?? null : null
          const nextBlockHash = currentBlock?.hash ?? persistedBlock.blockHash
          const nextBlockId = currentBlock?.id ?? persistedBlock.blockId
          const didBlockHashChange = nextBlockHash !== persistedBlock.blockHash
          const suggestions = nextSuggestions
            .filter((suggestion) => suggestion.source_hash === blockHash)
            .map((suggestion) =>
              didBlockHashChange
                ? {
                    ...suggestion,
                    block_id: nextBlockId,
                    source_hash: nextBlockHash,
                  }
                : suggestion,
            )

          return {
            previousBlock: persistedBlock,
            nextBlock: {
              ...persistedBlock,
              id: didBlockHashChange
                ? createCorrectionBlockRecordId(persistedBlock.writingId, nextBlockHash)
                : persistedBlock.id,
              blockId: nextBlockId,
              blockHash: nextBlockHash,
              suggestions,
            } satisfies LocalCorrectionBlock,
            deletedBlockIds: didBlockHashChange ? [persistedBlock.id] : [],
          }
        })
        .filter(
          (
            update,
          ): update is {
            previousBlock: LocalCorrectionBlock
            nextBlock: LocalCorrectionBlock
            deletedBlockIds: string[]
          } => update !== null,
        )

      if (updates.length === 0) {
        return
      }

      for (const update of updates) {
        if (update.deletedBlockIds.length > 0) {
          persistedCorrectionBlocksRef.current.delete(update.previousBlock.blockHash)
          await deleteLocalCorrectionBlocks([update.previousBlock.id])
        }

        await persistCorrectionBlockWriteThrough(update.nextBlock, update.deletedBlockIds)
      }
    },
    [editorInstanceRef, persistCorrectionBlockWriteThrough, persistedCorrectionBlocksRef],
  )

  const deletePersistedBlocksForPosition = useCallback(
    async (writingId: string, block: CorrectionTriggerBlock) => {
      const staleBlocks = findStaleCorrectionBlockRecords(
        [...persistedCorrectionBlocksRef.current.values()].map((candidate) => ({
          id: candidate.id,
          blockId: candidate.blockId,
          blockHash: candidate.blockHash,
        })),
        {
          id: block.id,
          hash: block.hash,
          pos: block.pos,
        },
        DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
      ).map((candidate) => persistedCorrectionBlocksRef.current.get(candidate.blockHash)).filter(
        (candidate): candidate is LocalCorrectionBlock => candidate !== undefined,
      )

      if (staleBlocks.length === 0) {
        return
      }

      staleBlocks.forEach((candidate) => {
        persistedCorrectionBlocksRef.current.delete(candidate.blockHash)
      })
      await deleteLocalCorrectionBlocks(staleBlocks.map((candidate) => candidate.id))

      void persistCorrectionBlockRemotely({
        writingId,
        deletedBlockIds: staleBlocks.map((candidate) => candidate.id),
      }).catch((error) => {
        console.info(
          `[corrections] stale delete skipped message=${error instanceof Error ? error.message : String(error)}`,
        )
      })
    },
    [persistedCorrectionBlocksRef],
  )

  const flushPendingCorrectionBlocks = useCallback(async (
    writingId: string,
    generation?: HydrationGeneration,
  ) => {
    const pendingResult = generation
      ? await generation.runAsync(() => readLocalCorrectionBlocks(writingId))
      : { status: "current" as const, value: await readLocalCorrectionBlocks(writingId) }
    if (pendingResult.status === "stale") return
    const pendingBlocks = pendingResult.value.filter((block) => block.syncedAt === null)

    for (const block of pendingBlocks) {
      if (generation && !generation.isCurrent()) return
      void persistCorrectionBlockRemotely({
        writingId,
        block,
      })
        .then(() => {
          const markPersisted = () =>
            persistedCorrectionBlocksRef.current.set(block.blockHash, {
              ...block,
              syncedAt: new Date().toISOString(),
            })
          if (generation) generation.run(markPersisted)
          else markPersisted()
        })
        .catch((error) => {
          const logFailure = () => console.info(
            `[corrections] retry skipped message=${error instanceof Error ? error.message : String(error)}`,
          )
          if (generation) generation.run(logFailure)
          else logFailure()
        })
    }
  }, [persistedCorrectionBlocksRef])

  return {
    correctionSuggestionBatcher,
    applyCorrectionSuggestionUpdate,
    setPersistedCorrectionBlocks,
    flattenPersistedSuggestions,
    createCorrectionAdmissionContext,
    admitCorrectionSuggestions,
    persistCorrectionBlockWriteThrough,
    updatePersistedBlocksFromSuggestions,
    deletePersistedBlocksForPosition,
    flushPendingCorrectionBlocks,
  }
}
