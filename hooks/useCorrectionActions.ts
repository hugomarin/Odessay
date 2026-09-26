"use client"

/**
 * Acciones del autor sobre las sugerencias de corrección: aplicarlas al
 * documento (rich o markdown), aceptar, rechazar, aceptar o rechazar todas,
 * aprender y olvidar palabras, y el toast del análisis.
 *
 * ODE-586 — corte 2 de `components/editor/editor-shell.tsx`, entrega 2b.
 * MUDANZA MECÁNICA: los cuerpos son los que vivían en la shell, con las mismas
 * dependencias más los refs y setters que ahora llegan por `input`
 * (identidades estables: la memoización no cambia). La propiedad del estado
 * NO cambia: el estado y los refs siguen siendo de la shell. Sin efectos, así
 * que el orden de efectos de la shell no cambia.
 */
import { useCallback } from "react"
import { admitSuggestions } from "@/lib/corrections/engine/admission"
import { createLearnedWordSet, normalizeLearnedWord } from "@/lib/corrections/learned-words"
import { primeLearnedWordsCache, removeCachedLearnedWord, upsertCachedLearnedWord } from "@/lib/corrections/learned-words-loader"
import { buildLearnWordRollbackState } from "@/lib/corrections/learned-words-rollback"
import { getResolvedCorrectionText, resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"
import { forgetCorrectionDecision, rememberCorrectionDecision } from "@/lib/editor/correction-memory-client"
import { applyPublicationSuggestionGroup, isSuggestionAcceptDisabled, updateSuggestionStatuses } from "@/lib/editor/suggestion-engine"
import { type PublicationSuggestion } from "@/lib/local-db/schema"
import { getAIService } from "@/lib/services/ai-service-factory"
import { type LearnedWordEntry } from "@/lib/services/contracts/ai-service"
import { TextSelection } from "@tiptap/pm/state"
import { type Editor } from "@tiptap/react"
import type { useCorrectionBlocks } from "@/hooks/useCorrectionBlocks"

type CorrectionBlocks = ReturnType<typeof useCorrectionBlocks>

export type CorrectionToastState = {
  phase: "running" | "complete" | "error"
  completed: number
  total: number
  message?: string
}

export type CorrectionActionsInput = {
  applyCorrectionSuggestionUpdate: CorrectionBlocks["applyCorrectionSuggestionUpdate"]
  applyMarkdownFromPanel: (nextMarkdown: string) => unknown
  automaticCorrectionSuggestionsRef: React.RefObject<PublicationSuggestion[]>
  correctionToastDismissRef: React.RefObject<number | null>
  createCorrectionAdmissionContext: CorrectionBlocks["createCorrectionAdmissionContext"]
  currentDocumentMarkdownRef: React.RefObject<string>
  editor: Editor | null
  isApplyingContentRef: React.RefObject<boolean>
  learnedWordsRef: React.RefObject<LearnedWordEntry[]>
  markdownSaveTimeoutRef: React.RefObject<number | null>
  modeRef: React.RefObject<"rich" | "markdown">
  persistEditorSnapshot: (editorInstance: Editor) => Promise<boolean>
  setCorrectionToast: React.Dispatch<React.SetStateAction<CorrectionToastState | null>>
  setLearnedWords: React.Dispatch<React.SetStateAction<LearnedWordEntry[]>>
  suppressCorrectionAnalysisUntilRef: React.RefObject<number>
  updateDerivedEditorState: (editorInstance: Editor) => void
  updatePersistedBlocksFromSuggestions: CorrectionBlocks["updatePersistedBlocksFromSuggestions"]
}

export function useCorrectionActions(input: CorrectionActionsInput) {
  const {
    applyCorrectionSuggestionUpdate,
    applyMarkdownFromPanel,
    automaticCorrectionSuggestionsRef,
    correctionToastDismissRef,
    createCorrectionAdmissionContext,
    currentDocumentMarkdownRef,
    editor,
    isApplyingContentRef,
    learnedWordsRef,
    markdownSaveTimeoutRef,
    modeRef,
    persistEditorSnapshot,
    setCorrectionToast,
    setLearnedWords,
    suppressCorrectionAnalysisUntilRef,
    updateDerivedEditorState,
    updatePersistedBlocksFromSuggestions,
  } = input

  const applyCorrectionSuggestionsByRange = useCallback(
    (targetSuggestions: PublicationSuggestion[]) => {
      if (!editor || modeRef.current !== "rich") {
        return {
          appliedIds: [] as string[],
          conflictIds: targetSuggestions.map((suggestion) => suggestion.id),
        }
      }

      const pendingSuggestions = targetSuggestions.filter((suggestion) => suggestion.status === "pending")

      if (pendingSuggestions.length === 0) {
        return {
          appliedIds: [] as string[],
          conflictIds: [],
        }
      }

      const resolvedRanges = resolveCorrectionDecorationRanges(editor.state.doc, pendingSuggestions)
      const rangesById = new Map(resolvedRanges.map((range) => [range.suggestion.id, range]))
      const applicableRanges = pendingSuggestions
        .map((suggestion) => {
          const range = rangesById.get(suggestion.id) ?? null

          if (!range) {
            return null
          }

          return getResolvedCorrectionText(editor.state.doc, range) === suggestion.original_text
            ? range
            : null
        })
        .filter((range): range is NonNullable<typeof range> => range !== null)
        .sort((left, right) => right.from - left.from)

      if (applicableRanges.length === 0) {
        return {
          appliedIds: [] as string[],
          conflictIds: pendingSuggestions.map((suggestion) => suggestion.id),
        }
      }

      const selectionBookmark = editor.state.selection.getBookmark()
      const transaction = editor.state.tr

      for (const { suggestion, from, to } of applicableRanges) {
        transaction.insertText(suggestion.replacement_text, from, to)
      }

      try {
        transaction.setSelection(selectionBookmark.map(transaction.mapping).resolve(transaction.doc))
      } catch {
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.from)))
      }

      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
        markdownSaveTimeoutRef.current = null
      }

      suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
      isApplyingContentRef.current = true
      editor.view.dispatch(transaction)
      isApplyingContentRef.current = false
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)

      const appliedIds = applicableRanges.map((range) => range.suggestion.id)

      return {
        appliedIds,
        conflictIds: pendingSuggestions
          .filter((suggestion) => !appliedIds.includes(suggestion.id))
          .map((suggestion) => suggestion.id),
      }
    },
    [editor, persistEditorSnapshot, updateDerivedEditorState, isApplyingContentRef, markdownSaveTimeoutRef, modeRef, suppressCorrectionAnalysisUntilRef],
  )

  const applyCorrectionSuggestionsFromMarkdown = useCallback(
    (targetSuggestions: PublicationSuggestion[]) => {
      const result = applyPublicationSuggestionGroup(currentDocumentMarkdownRef.current, targetSuggestions)

      if (result.appliedIds.length > 0) {
        suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
        applyMarkdownFromPanel(result.markdown)
      }

      return {
        appliedIds: result.appliedIds,
        conflictIds: result.conflictIds,
      }
    },
    [applyMarkdownFromPanel, currentDocumentMarkdownRef, suppressCorrectionAnalysisUntilRef],
  )

  const applyCorrectionSuggestions = useCallback(
    (targetSuggestions: PublicationSuggestion[]) => {
      if (modeRef.current === "rich") {
        return applyCorrectionSuggestionsByRange(targetSuggestions)
      }

      return applyCorrectionSuggestionsFromMarkdown(targetSuggestions)
    },
    [applyCorrectionSuggestionsByRange, applyCorrectionSuggestionsFromMarkdown, modeRef],
  )


  const handleAcceptCorrection = useCallback(
    (suggestion: PublicationSuggestion, suggestionIds: string[] = [suggestion.id]) => {
      if (isSuggestionAcceptDisabled(suggestion)) {
        return
      }

      const suggestionIdSet = new Set(suggestionIds)
      const targetSuggestions = automaticCorrectionSuggestionsRef.current.filter((item) => suggestionIdSet.has(item.id))
      const result = applyCorrectionSuggestions(targetSuggestions)

      automaticCorrectionSuggestionsRef.current
        .filter((item) => result.appliedIds.includes(item.id))
        .forEach((item) => rememberCorrectionDecision(item.correction_fingerprint, "accepted"))

      let nextSuggestions = automaticCorrectionSuggestionsRef.current

      if (result.appliedIds.length > 0) {
        nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.appliedIds, "accepted")
      }

      if (result.conflictIds.length > 0) {
        nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.conflictIds, "conflict")
      }

      if (result.appliedIds.length > 0 || result.conflictIds.length > 0) {
        applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
        void updatePersistedBlocksFromSuggestions(
          nextSuggestions,
          [
            ...new Set(
              targetSuggestions
                .map((item) => item.source_hash ?? "")
                .filter(Boolean),
            ),
          ],
        )
      }
    },
    [applyCorrectionSuggestionUpdate, applyCorrectionSuggestions, updatePersistedBlocksFromSuggestions, automaticCorrectionSuggestionsRef],
  )

  const showCorrectionToast = useCallback((toast: CorrectionToastState, durationMs: number) => {
    setCorrectionToast(toast)

    if (correctionToastDismissRef.current !== null) {
      window.clearTimeout(correctionToastDismissRef.current)
    }

    correctionToastDismissRef.current = window.setTimeout(() => {
      setCorrectionToast(null)
      correctionToastDismissRef.current = null
    }, durationMs)
  }, [correctionToastDismissRef, setCorrectionToast])

  const handleRejectCorrection = useCallback((suggestionId: string) => {
    const suggestion = automaticCorrectionSuggestionsRef.current.find((item) => item.id === suggestionId)

    if (!suggestion) {
      return
    }

    rememberCorrectionDecision(suggestion.correction_fingerprint, "rejected")
    const nextSuggestions = updateSuggestionStatuses(
      automaticCorrectionSuggestionsRef.current,
      [suggestionId],
      "rejected",
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
  }, [applyCorrectionSuggestionUpdate, updatePersistedBlocksFromSuggestions, automaticCorrectionSuggestionsRef])

  const handleLearnWord = useCallback((suggestion: PublicationSuggestion, suggestionIds: string[] = [suggestion.id]) => {
    const normalizedWord = normalizeLearnedWord(suggestion.original_text)

    if (!normalizedWord) {
      handleRejectCorrection(suggestion.id)
      return
    }

    const targetIds = [
      ...new Set([
        ...suggestionIds,
        ...automaticCorrectionSuggestionsRef.current
          .filter((item) => normalizeLearnedWord(item.original_text) === normalizedWord)
          .map((item) => item.id),
      ]),
    ]
    const sourceHashes = [
      ...new Set(
        automaticCorrectionSuggestionsRef.current
          .map((item) => item.source_hash ?? "")
          .filter(Boolean),
      ),
    ]

    const optimisticEntry: LearnedWordEntry = {
      id: `pending:${normalizedWord}`,
      word: normalizedWord,
      language: "unknown",
      createdAt: new Date().toISOString(),
    }

    setLearnedWords((current) => {
      if (current.some((item) => item.word === normalizedWord)) {
        return current
      }

      return [optimisticEntry, ...current]
    })

    automaticCorrectionSuggestionsRef.current
      .filter((item) => targetIds.includes(item.id))
      .forEach((item) => rememberCorrectionDecision(item.correction_fingerprint, "rejected"))

    const nextSuggestions = admitSuggestions(
      updateSuggestionStatuses(
        automaticCorrectionSuggestionsRef.current,
        targetIds,
        "rejected",
      ),
      {
        ...createCorrectionAdmissionContext(),
        learnedWords: createLearnedWordSet([
          normalizedWord,
          ...learnedWordsRef.current.map((item) => item.word),
        ]),
      },
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(nextSuggestions, sourceHashes)

    void getAIService().learnWord({
      word: suggestion.original_text,
      language: "unknown",
    }).then((result) => {
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Could not save learned word.")
      }

      upsertCachedLearnedWord(result.data)
      setLearnedWords((current) => {
        const withoutOptimistic = current.filter((item) => item.id !== optimisticEntry.id)

        if (withoutOptimistic.some((item) => item.word === result.data.word)) {
          return withoutOptimistic
        }

        return [result.data, ...withoutOptimistic]
      })
    }).catch((error) => {
      console.error("[learned-words] persist failed", error)
      automaticCorrectionSuggestionsRef.current
        .filter((item) => targetIds.includes(item.id))
        .forEach((item) => forgetCorrectionDecision(item.correction_fingerprint))

      const rollbackState = buildLearnWordRollbackState({
        learnedWords: learnedWordsRef.current,
        optimisticEntryId: optimisticEntry.id,
        suggestions: automaticCorrectionSuggestionsRef.current,
        targetIds,
        admissionContext: createCorrectionAdmissionContext(),
      })
      setLearnedWords(rollbackState.learnedWords)
      applyCorrectionSuggestionUpdate(() => rollbackState.suggestions, { immediate: true })
      void updatePersistedBlocksFromSuggestions(rollbackState.suggestions, sourceHashes)
      showCorrectionToast({
        phase: "complete",
        completed: 0,
        total: 0,
        message: "We couldn't save that word. Try again.",
      }, 4000)
    })
  }, [
    applyCorrectionSuggestionUpdate,
    createCorrectionAdmissionContext,
    handleRejectCorrection,
    showCorrectionToast,
    updatePersistedBlocksFromSuggestions,
    automaticCorrectionSuggestionsRef,
    learnedWordsRef,
    setLearnedWords,
  ])

  const handleRemoveLearnedWord = useCallback((id: string) => {
    const previous = learnedWordsRef.current
    setLearnedWords(previous.filter((item) => item.id !== id))
    removeCachedLearnedWord(id)

    void getAIService().deleteLearnedWord(id).then((result) => {
      if (result.error) {
        throw new Error(result.error.message)
      }
    }).catch((error) => {
      console.error("[learned-words] delete failed", error)
      primeLearnedWordsCache(previous)
      setLearnedWords(previous)
    })
  }, [learnedWordsRef, setLearnedWords])

  const handleAcceptAllCorrections = useCallback(() => {
    const pendingSuggestions = automaticCorrectionSuggestionsRef.current.filter((suggestion) => suggestion.status === "pending")
    const result = applyCorrectionSuggestions(pendingSuggestions)

    if (result.appliedIds.length === 0 && result.conflictIds.length === 0) {
      return
    }

    automaticCorrectionSuggestionsRef.current
      .filter((suggestion) => result.appliedIds.includes(suggestion.id))
      .forEach((suggestion) => rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted"))

    let nextSuggestions = automaticCorrectionSuggestionsRef.current
    if (result.appliedIds.length > 0) {
      nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.appliedIds, "accepted")
    }
    if (result.conflictIds.length > 0) {
      nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.conflictIds, "conflict")
    }
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(
      nextSuggestions,
      [
        ...new Set(
          automaticCorrectionSuggestionsRef.current
            .filter((suggestion) => result.appliedIds.includes(suggestion.id))
            .map((suggestion) => suggestion.source_hash ?? "")
            .filter(Boolean),
        ),
      ],
    )
  }, [applyCorrectionSuggestionUpdate, applyCorrectionSuggestions, updatePersistedBlocksFromSuggestions, automaticCorrectionSuggestionsRef])

  const handleRejectAllCorrections = useCallback(() => {
    const pending = automaticCorrectionSuggestionsRef.current.filter((s) => s.status === "pending")

    pending.forEach((suggestion) => rememberCorrectionDecision(suggestion.correction_fingerprint, "rejected"))
    const nextSuggestions = updateSuggestionStatuses(
      automaticCorrectionSuggestionsRef.current,
      pending.map((s) => s.id),
      "rejected",
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(
      nextSuggestions,
      [...new Set(pending.map((suggestion) => suggestion.source_hash ?? "").filter(Boolean))],
    )
  }, [applyCorrectionSuggestionUpdate, updatePersistedBlocksFromSuggestions, automaticCorrectionSuggestionsRef])


  return {
    applyCorrectionSuggestions,
    handleAcceptCorrection,
    showCorrectionToast,
    handleRejectCorrection,
    handleLearnWord,
    handleRemoveLearnedWord,
    handleAcceptAllCorrections,
    handleRejectAllCorrections,
  }
}
