"use client"

/**
 * Ciclo de vida de las correcciones en el editor: espejos de sugerencias y
 * palabras aprendidas, carga de palabras aprendidas, el análisis manual
 * (`useManualCorrections`), la invalidación de sugerencias cuando el autor
 * edita un bloque, el volcado de bloques pendientes al recuperar la conexión
 * y las acciones en línea desde las decoraciones.
 *
 * ODE-586 — corte 2 de `components/editor/editor-shell.tsx`, entrega 2b.
 * MUDANZA MECÁNICA: los cuerpos y los efectos son los que vivían en la shell,
 * en el mismo orden, y la shell llama a este hook en la posición del primero
 * de ellos, así que el orden de efectos no cambia. Dependencias: las de la
 * shell más los refs y setters que ahora llegan por `input` (identidades
 * estables). La propiedad del estado NO cambia.
 */
import { useCallback, useEffect } from "react"
import { useManualCorrections } from "@/hooks/useManualCorrections"
import { admitSuggestions } from "@/lib/corrections/engine/admission"
import { createStableFingerprint } from "@/lib/corrections/engine/identity"
import { consumeDeferredCorrectionBlocks, deferCorrectionBlocks, type DeferredCorrectionBlocksState } from "@/lib/corrections/engine/lifecycle"
import { createLearnedWordSet } from "@/lib/corrections/learned-words"
import { loadCachedLearnedWordsPages, mergeLearnedWordEntries, primeLearnedWordsCache } from "@/lib/corrections/learned-words-loader"
import { readCorrectionMemory, rememberCorrectionDecision } from "@/lib/editor/correction-memory-client"
import { acknowledgeCorrectionDirtyBlocks, type CorrectionTriggerBlock, getCurrentCorrectionBlock } from "@/lib/editor/correction-trigger-plugin"
import { deriveSuggestionContexts, hashPublicationSource, invalidateBlockSuggestions, isSuggestionAcceptDisabled, updateSuggestionStatuses } from "@/lib/editor/suggestion-engine"
import { type LocalCorrectionBlock, type PublicationSuggestion } from "@/lib/local-db/schema"
import { logCorrectionEvent } from "@/lib/observability/corrections-log"
import { getAIService } from "@/lib/services/ai-service-factory"
import { type LearnedWordEntry } from "@/lib/services/contracts/ai-service"
import { type Editor } from "@tiptap/react"
import type { useCorrectionActions } from "@/hooks/useCorrectionActions"
import type { useCorrectionBlocks } from "@/hooks/useCorrectionBlocks"

type CorrectionBlocks = ReturnType<typeof useCorrectionBlocks>
type CorrectionActions = ReturnType<typeof useCorrectionActions>

export type CorrectionLifecycleInput = {
  admitCorrectionSuggestions: CorrectionBlocks["admitCorrectionSuggestions"]
  applyCorrectionSuggestionUpdate: CorrectionBlocks["applyCorrectionSuggestionUpdate"]
  applyCorrectionSuggestions: CorrectionActions["applyCorrectionSuggestions"]
  automaticCorrectionSuggestions: PublicationSuggestion[]
  automaticCorrectionSuggestionsRef: React.RefObject<PublicationSuggestion[]>
  createCorrectionAdmissionContext: CorrectionBlocks["createCorrectionAdmissionContext"]
  currentDocumentMarkdownRef: React.RefObject<string>
  currentWritingId: string | null
  currentWritingIdRef: React.RefObject<string | null>
  deferredSuppressedCorrectionBlocksRef: React.RefObject<DeferredCorrectionBlocksState<CorrectionTriggerBlock>>
  deletePersistedBlocksForPosition: CorrectionBlocks["deletePersistedBlocksForPosition"]
  editor: Editor | null
  editorInstanceRef: React.RefObject<Editor | null>
  flushPendingCorrectionBlocks: CorrectionBlocks["flushPendingCorrectionBlocks"]
  handleLearnWord: CorrectionActions["handleLearnWord"]
  learnedWords: LearnedWordEntry[]
  learnedWordsLoadedRef: React.RefObject<boolean>
  learnedWordsRef: React.RefObject<LearnedWordEntry[]>
  modeRef: React.RefObject<"rich" | "markdown">
  persistCorrectionBlockWriteThrough: CorrectionBlocks["persistCorrectionBlockWriteThrough"]
  persistedCorrectionBlocksRef: React.RefObject<Map<string, LocalCorrectionBlock>>
  setLearnedWords: React.Dispatch<React.SetStateAction<LearnedWordEntry[]>>
  setLearnedWordsLoading: React.Dispatch<React.SetStateAction<boolean>>
  showCorrectionToast: CorrectionActions["showCorrectionToast"]
  suppressCorrectionAnalysisUntilRef: React.RefObject<number>
  suppressedCorrectionFlushTimerRef: React.RefObject<number | null>
  titleRef: React.RefObject<string>
  updatePersistedBlocksFromSuggestions: CorrectionBlocks["updatePersistedBlocksFromSuggestions"]
}

export function useCorrectionLifecycle(input: CorrectionLifecycleInput) {
  const {
    admitCorrectionSuggestions,
    applyCorrectionSuggestionUpdate,
    applyCorrectionSuggestions,
    automaticCorrectionSuggestions,
    automaticCorrectionSuggestionsRef,
    createCorrectionAdmissionContext,
    currentDocumentMarkdownRef,
    currentWritingId,
    currentWritingIdRef,
    deferredSuppressedCorrectionBlocksRef,
    deletePersistedBlocksForPosition,
    editor,
    editorInstanceRef,
    flushPendingCorrectionBlocks,
    handleLearnWord,
    learnedWords,
    learnedWordsLoadedRef,
    learnedWordsRef,
    modeRef,
    persistCorrectionBlockWriteThrough,
    persistedCorrectionBlocksRef,
    setLearnedWords,
    setLearnedWordsLoading,
    showCorrectionToast,
    suppressCorrectionAnalysisUntilRef,
    suppressedCorrectionFlushTimerRef,
    titleRef,
    updatePersistedBlocksFromSuggestions,
  } = input

  useEffect(() => {
    automaticCorrectionSuggestionsRef.current = automaticCorrectionSuggestions
  }, [automaticCorrectionSuggestions, automaticCorrectionSuggestionsRef])

  useEffect(() => {
    learnedWordsRef.current = learnedWords
  }, [learnedWords, learnedWordsRef])

  useEffect(() => {
    if (!currentWritingId || learnedWordsLoadedRef.current) {
      return
    }

    setLearnedWordsLoading(true)

    void loadCachedLearnedWordsPages(getAIService()).then((result) => {
      if (!result.ok) {
        console.info(`[learned-words] load skipped message=${result.message}`)
        return
      }

      learnedWordsLoadedRef.current = true
      const nextLearnedWords = mergeLearnedWordEntries(learnedWordsRef.current, result.items)
      primeLearnedWordsCache(nextLearnedWords)
      setLearnedWords(nextLearnedWords)
      const sourceHashes = [
        ...new Set(
          automaticCorrectionSuggestionsRef.current
            .map((suggestion) => suggestion.source_hash ?? "")
            .filter(Boolean),
        ),
      ]
      const nextSuggestions = admitSuggestions(
        automaticCorrectionSuggestionsRef.current,
        {
          ...createCorrectionAdmissionContext(),
          learnedWords: createLearnedWordSet(nextLearnedWords.map((item) => item.word)),
        },
      )
      applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
      void updatePersistedBlocksFromSuggestions(nextSuggestions, sourceHashes)
    }).finally(() => {
      setLearnedWordsLoading(false)
    })
  }, [
    applyCorrectionSuggestionUpdate,
    createCorrectionAdmissionContext,
    currentWritingId,
    updatePersistedBlocksFromSuggestions,
    automaticCorrectionSuggestionsRef,
    learnedWordsLoadedRef,
    learnedWordsRef,
    setLearnedWords,
    setLearnedWordsLoading,
  ])

  const normalizeAutomaticSuggestion = useCallback(
    (block: CorrectionTriggerBlock, suggestion: PublicationSuggestion): PublicationSuggestion => {
      const sourceMarkdown = currentDocumentMarkdownRef.current
      const occurrence = suggestion.occurrence ?? 0
      const fingerprint =
        suggestion.correction_fingerprint ??
        createStableFingerprint({
          type: suggestion.mechanical_type ?? suggestion.kind,
          originalText: suggestion.original_text,
          replacementText: suggestion.replacement_text,
        })
      const id = [
        "auto-correction",
        block.hash,
        hashPublicationSource(`${fingerprint}:${occurrence}`),
      ].join(":")

      return {
        ...suggestion,
        ...deriveSuggestionContexts(sourceMarkdown, suggestion.original_text),
        id,
        block_id: block.id,
        source_hash: block.hash,
        correction_fingerprint: fingerprint,
        occurrence,
        status: "pending",
      }
    },
    [currentDocumentMarkdownRef],
  )

  const {
    runState: correctionAnalysisRunState,
    progress: correctionAnalysisProgress,
    startAnalysis: startCorrectionAnalysis,
    retryFailedPackages: retryFailedCorrectionPackages,
    cancelAnalysis: cancelCorrectionAnalysis,
  } = useManualCorrections({
    currentWritingId,
    editorRef: editorInstanceRef,
    currentWritingIdRef,
    titleRef,
    learnedWordsRef,
    persistedCorrectionBlocksRef,
    readCorrectionMemory,
    admitCorrectionSuggestions,
    applyCorrectionSuggestionUpdate,
    normalizeAutomaticSuggestion,
    persistCorrectionBlockWriteThrough,
    updatePersistedBlocksFromSuggestions,
    logCorrectionEvent,
    showCorrectionToast,
  })


  useEffect(() => {
    if (!editor) {
      return
    }

    const scheduleDeferredSuppressedFlush = () => {
      if (suppressedCorrectionFlushTimerRef.current !== null) {
        return
      }

      const flushAt = deferredSuppressedCorrectionBlocksRef.current.flushAt

      if (flushAt === null) {
        return
      }

      suppressedCorrectionFlushTimerRef.current = window.setTimeout(() => {
        suppressedCorrectionFlushTimerRef.current = null

        if (modeRef.current !== "rich") {
          deferredSuppressedCorrectionBlocksRef.current = {
            blocksById: new Map(),
            flushAt: null,
          }
          return
        }

        const consumed = consumeDeferredCorrectionBlocks(deferredSuppressedCorrectionBlocksRef.current)
        deferredSuppressedCorrectionBlocksRef.current = consumed.state
        processDirtyCorrectionBlocks(
          consumed.blocks
            .map((block) => getCurrentCorrectionBlock(editor.state.doc, block.id) ?? block)
            .filter((block) => block.text.trim().length > 0),
        )
      }, Math.max(0, flushAt - Date.now()))
    }

    const processDirtyCorrectionBlocks = (blocks: CorrectionTriggerBlock[]) => {
      for (const block of blocks) {
        if (currentWritingIdRef.current) {
          void deletePersistedBlocksForPosition(currentWritingIdRef.current, block)
        }

        const applyStaleInvalidation = (markResolvableStale = true) => {
          applyCorrectionSuggestionUpdate((current) => {
            const invalidation = invalidateBlockSuggestions(current, block, Date.now(), markResolvableStale)

            for (const suggestionId of invalidation.droppedIds) {
              logCorrectionEvent({
                type: "stale:drop",
                blockId: block.id,
                suggestionId,
              })
            }

            for (const suggestionId of invalidation.keptIds) {
              logCorrectionEvent({
                type: "stale:keep",
                blockId: block.id,
                suggestionId,
              })
            }

            return invalidation.suggestions
          })
        }

        // Un bloque editado invalida sus sugerencias vigentes, sin marcarlas
        // como "resolubles como stale": eso ultimo solo tenia sentido cuando
        // el analisis automatico iba a volver a revisar el bloque por su
        // cuenta. El analisis manual lo dispara el usuario, asi que la
        // sugerencia vieja se cae y punto (ODE-558).
        applyStaleInvalidation(false)
      }
    }

    const handleDirtyBlocks = (event: Event) => {
      const blocks = ((event as CustomEvent<{ blocks?: CorrectionTriggerBlock[] }>).detail?.blocks ?? [])

      acknowledgeCorrectionDirtyBlocks(editor, blocks.map((block) => block.id))

      if (modeRef.current !== "rich") {
        return
      }

      if (Date.now() < suppressCorrectionAnalysisUntilRef.current) {
        deferredSuppressedCorrectionBlocksRef.current = deferCorrectionBlocks(
          deferredSuppressedCorrectionBlocksRef.current,
          blocks,
          suppressCorrectionAnalysisUntilRef.current,
        )
        scheduleDeferredSuppressedFlush()
        return
      }

      processDirtyCorrectionBlocks(blocks)
    }

    editor.view.dom.addEventListener("odessay:correction-dirty-blocks", handleDirtyBlocks)

    return () => {
      editor.view.dom.removeEventListener("odessay:correction-dirty-blocks", handleDirtyBlocks)
      if (suppressedCorrectionFlushTimerRef.current !== null) {
        window.clearTimeout(suppressedCorrectionFlushTimerRef.current)
        suppressedCorrectionFlushTimerRef.current = null
      }
    }
  }, [applyCorrectionSuggestionUpdate, deletePersistedBlocksForPosition, editor, currentWritingIdRef, deferredSuppressedCorrectionBlocksRef, modeRef, suppressCorrectionAnalysisUntilRef, suppressedCorrectionFlushTimerRef])

  useEffect(() => {
    const handleOnline = () => {
      const writingId = currentWritingIdRef.current

      if (!writingId) {
        return
      }

      void flushPendingCorrectionBlocks(writingId)
    }

    window.addEventListener("online", handleOnline)

    return () => {
      window.removeEventListener("online", handleOnline)
    }
  }, [flushPendingCorrectionBlocks, currentWritingIdRef])

  useEffect(() => {
    const handleAutomaticInlineAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; suggestionId?: string }>).detail
      const suggestionId = detail?.suggestionId

      if (!suggestionId) {
        return
      }

      const suggestion = automaticCorrectionSuggestionsRef.current.find((item) => item.id === suggestionId)

      if (!suggestion) {
        return
      }

      if (isSuggestionAcceptDisabled(suggestion) && detail.action === "accept") {
        return
      }

      if (detail.action === "accept") {
        const result = applyCorrectionSuggestions([suggestion])

        if (result.appliedIds.length > 0) {
          rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted")
        }

        let nextSuggestions = automaticCorrectionSuggestionsRef.current

        if (result.appliedIds.length > 0) {
          nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.appliedIds, "accepted")
        }

        if (result.conflictIds.length > 0) {
          nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.conflictIds, "conflict")
        }

        if (result.appliedIds.length > 0 || result.conflictIds.length > 0) {
          applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
          void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
        }
        return
      }

      if (detail.action === "reject") {
        rememberCorrectionDecision(suggestion.correction_fingerprint, "rejected")
        const nextSuggestions = updateSuggestionStatuses(
          automaticCorrectionSuggestionsRef.current,
          [suggestion.id],
          "rejected",
        )
        applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
        void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
        return
      }

      if (detail.action === "learn") {
        handleLearnWord(suggestion)
      }
    }

    window.addEventListener("odessay:publication-suggestion-action", handleAutomaticInlineAction)

    return () => {
      window.removeEventListener("odessay:publication-suggestion-action", handleAutomaticInlineAction)
    }
  }, [applyCorrectionSuggestionUpdate, applyCorrectionSuggestions, handleLearnWord, updatePersistedBlocksFromSuggestions, automaticCorrectionSuggestionsRef])

  return {
    correctionAnalysisRunState,
    correctionAnalysisProgress,
    startCorrectionAnalysis,
    retryFailedCorrectionPackages,
    cancelCorrectionAnalysis,
  }
}
