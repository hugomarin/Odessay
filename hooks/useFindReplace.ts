"use client"

/**
 * El cableado de React de buscar y reemplazar en el editor: las coincidencias
 * (rich y markdown), el índice activo, las decoraciones en el editor real,
 * abrir y cerrar el panel (guardando y restaurando el cursor), navegar entre
 * coincidencias y reemplazar una o todas. La lógica pura es de
 * `lib/editor/find-replace.ts`.
 *
 * ODE-602 — corte 4a de `components/editor/editor-shell.tsx`, entrega 2.
 * MUDANZA MECÁNICA, como ODE-587: los cuerpos, los memos y los tres efectos
 * son los que vivían en la shell, en el mismo orden, y la shell llama a este
 * hook donde empezaban sus efectos. Los memos vivían justo antes del efecto
 * que publica el estado de la pestaña; ese efecto no los lee, así que bajarlos
 * detrás de él no cambia nada. El estado y los refs siguen siendo de la shell
 * y llegan por `input`; las dependencias son las de la shell más esos refs y
 * setters (identidades estables).
 *
 * Conocido y NO arreglado aquí (ODE-630): `richFindMatches` se memoriza con
 * `editor` y no con el documento, así que Replace y Replace all pueden escribir
 * en posiciones rancias. Viaja tal cual; sus casos son `it.fails` en
 * `tests/editor-shell-chrome-find-replace.test.tsx`.
 */
import { useCallback, useEffect, useMemo } from "react"
import { TextSelection } from "@tiptap/pm/state"
import { type Editor } from "@tiptap/react"
import type { MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import {
  clampFindReplaceIndex,
  clearFindReplaceQueryState,
  findDocumentMatches,
  findTextMatches,
  renderFindReplaceOverlayHtml,
  replaceAllMatchesInText,
  replaceMatchInText,
  resolveNextFindReplaceIndex,
  setFindReplaceQueryState,
} from "@/lib/editor/find-replace"

export type EditorCursorSnapshot =
  | {
      mode: "rich"
      from: number
      to: number
    }
  | {
      mode: "markdown"
      start: number
      end: number
      scrollTop?: number
      scrollLeft?: number
      editorScrollTop?: number
      editorScrollLeft?: number
      shellScrollTop?: number
      shellScrollLeft?: number
      windowScrollX?: number
      windowScrollY?: number
    }

type MarkdownCursorScroll = Omit<Extract<EditorCursorSnapshot, { mode: "markdown" }>, "mode" | "start" | "end">

// ODE-625: la selección Markdown cacheada lleva el documento al que pertenece.
type OwnedMarkdownSelectionSnapshot = MarkdownSelectionSnapshot & {
  writingId: string
}

export type FindReplaceInput = {
  currentWritingId: string | null
  currentWritingIdRef: React.RefObject<string | null>
  editor: Editor | null
  editorCursorSnapshotRef: React.RefObject<EditorCursorSnapshot | null>
  findActiveIndex: number
  findCaseSensitive: boolean
  findInputRef: React.RefObject<HTMLInputElement | null>
  findQuery: string
  handleMarkdownChange: (value: string) => void
  isFindReplaceOpen: boolean
  markdownSelectionOwnerId: (writingId: string | null) => string
  markdownSelectionRef: React.RefObject<OwnedMarkdownSelectionSnapshot | null>
  markdownTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  markdownValue: string
  mode: "rich" | "markdown"
  modeRef: React.RefObject<"rich" | "markdown">
  persistEditorSnapshot: (editor: Editor) => Promise<boolean>
  queueMarkdownSelectionRestore: (start: number, end: number, options?: MarkdownCursorScroll) => void
  replaceInputRef: React.RefObject<HTMLInputElement | null>
  replaceValue: string
  setFindActiveIndex: React.Dispatch<React.SetStateAction<number>>
  setFindQuery: React.Dispatch<React.SetStateAction<string>>
  setIsFindReplaceOpen: React.Dispatch<React.SetStateAction<boolean>>
  setReplaceValue: React.Dispatch<React.SetStateAction<string>>
  updateDerivedEditorState: (editor: Editor) => void
}

export function useFindReplace(input: FindReplaceInput) {
  const {
    currentWritingId,
    currentWritingIdRef,
    editor,
    editorCursorSnapshotRef,
    findActiveIndex,
    findCaseSensitive,
    findInputRef,
    findQuery,
    handleMarkdownChange,
    isFindReplaceOpen,
    markdownSelectionOwnerId,
    markdownSelectionRef,
    markdownTextareaRef,
    markdownValue,
    mode,
    modeRef,
    persistEditorSnapshot,
    queueMarkdownSelectionRestore,
    replaceInputRef,
    replaceValue,
    setFindActiveIndex,
    setFindQuery,
    setIsFindReplaceOpen,
    setReplaceValue,
    updateDerivedEditorState,
  } = input

  const markdownFindMatches = useMemo(
    () => (isFindReplaceOpen ? findTextMatches(markdownValue, findQuery, findCaseSensitive) : []),
    [findCaseSensitive, findQuery, isFindReplaceOpen, markdownValue],
  )
  const richFindMatches = useMemo(
    () => (editor && isFindReplaceOpen ? findDocumentMatches(editor.state.doc, findQuery, findCaseSensitive) : []),
    [editor, findCaseSensitive, findQuery, isFindReplaceOpen],
  )
  const matchCount =
    mode === "markdown" ? markdownFindMatches.length : richFindMatches.length
  const activeMatchIndex = clampFindReplaceIndex(matchCount, findActiveIndex)
  const markdownOverlayHtml = useMemo(
    () =>
      mode === "markdown" && isFindReplaceOpen && findQuery.trim()
        ? renderFindReplaceOverlayHtml(markdownValue, findQuery, findCaseSensitive, activeMatchIndex)
        : undefined,
    [activeMatchIndex, findCaseSensitive, findQuery, isFindReplaceOpen, markdownValue, mode],
  )

  useEffect(() => {
    if (!editor) {
      return
    }

    if (!isFindReplaceOpen || !findQuery.trim()) {
      clearFindReplaceQueryState(editor)
      return
    }

    setFindReplaceQueryState(editor, {
      query: findQuery,
      caseSensitive: findCaseSensitive,
      activeIndex: activeMatchIndex,
    })
  }, [activeMatchIndex, editor, findCaseSensitive, findQuery, isFindReplaceOpen])

  useEffect(() => {
    if (findActiveIndex !== activeMatchIndex) {
      setFindActiveIndex(activeMatchIndex)
    }
  }, [activeMatchIndex, findActiveIndex, setFindActiveIndex])

  useEffect(() => {
    if (!isFindReplaceOpen || !findQuery.trim()) {
      setFindActiveIndex(0)
      return
    }

    setFindActiveIndex(0)
  }, [findCaseSensitive, findQuery, isFindReplaceOpen, setFindActiveIndex])

  function captureEditorCursorSnapshot(): EditorCursorSnapshot | null {
    if (modeRef.current === "markdown") {
      const textarea = markdownTextareaRef.current
      const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
      const shellViewport = document.querySelector<HTMLElement>("main")

      if (!textarea) {
        return null
      }

      return {
        mode: "markdown",
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        scrollTop: textarea.scrollTop,
        scrollLeft: textarea.scrollLeft,
        editorScrollTop: editorViewport?.scrollTop,
        editorScrollLeft: editorViewport?.scrollLeft,
        shellScrollTop: shellViewport?.scrollTop,
        shellScrollLeft: shellViewport?.scrollLeft,
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
      }
    }

    if (!editor) {
      return null
    }

    return {
      mode: "rich",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }
  }

  function restoreEditorCursorSnapshot(snapshot: EditorCursorSnapshot | null) {
    if (!snapshot) {
      return
    }

    if (snapshot.mode === "markdown") {
      queueMarkdownSelectionRestore(snapshot.start, snapshot.end, snapshot)
      return
    }

    if (!editor) {
      return
    }

    editor.chain().focus().setTextSelection({ from: snapshot.from, to: snapshot.to }).run()
  }

  function closeFindReplacePanel(options?: { restoreSelection?: boolean }) {
    const snapshot = editorCursorSnapshotRef.current

    setIsFindReplaceOpen(false)
    setFindQuery("")
    setReplaceValue("")
    setFindActiveIndex(0)

    if (editor) {
      clearFindReplaceQueryState(editor)
    }

    if (options?.restoreSelection !== false) {
      window.requestAnimationFrame(() => {
        restoreEditorCursorSnapshot(snapshot)
      })
    }
  }

  function openFindReplacePanel(options?: { focusReplace?: boolean }) {
    editorCursorSnapshotRef.current = captureEditorCursorSnapshot()

    if (!isFindReplaceOpen) {
      setFindActiveIndex(0)
    }

    setIsFindReplaceOpen(true)

    window.requestAnimationFrame(() => {
      if (options?.focusReplace) {
        replaceInputRef.current?.focus()
        return
      }

      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }

  function syncActiveRichMatchSelection(nextActiveIndex: number) {
    if (!editor || !isFindReplaceOpen || !findQuery.trim()) {
      return
    }

    const targetMatch = richFindMatches[clampFindReplaceIndex(richFindMatches.length, nextActiveIndex)]

    if (!targetMatch) {
      return
    }

    const transaction = editor.state.tr
    transaction.setSelection(TextSelection.create(transaction.doc, targetMatch.from, targetMatch.to))
    transaction.scrollIntoView()
    transaction.setMeta("addToHistory", false)
    editor.view.dispatch(transaction)

    window.requestAnimationFrame(() => {
      const activeMatchElement = editor.view.dom.querySelector<HTMLElement>(".od-find-match-active")

      if (activeMatchElement) {
        activeMatchElement.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "auto",
        })
        return
      }

      const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
      const startCoords = editor.view.coordsAtPos(targetMatch.from)
      const endCoords = editor.view.coordsAtPos(targetMatch.to)

      if (!editorViewport) {
        return
      }

      const viewportRect = editorViewport.getBoundingClientRect()
      const matchTop = startCoords.top
      const matchBottom = Math.max(startCoords.bottom, endCoords.bottom)
      const topInset = 96
      const bottomInset = 56

      if (matchTop < viewportRect.top + topInset) {
        editorViewport.scrollBy({
          top: matchTop - viewportRect.top - topInset,
          behavior: "auto",
        })
        return
      }

      if (matchBottom > viewportRect.bottom - bottomInset) {
        editorViewport.scrollBy({
          top: matchBottom - viewportRect.bottom + bottomInset,
          behavior: "auto",
        })
      }
    })
  }

  function syncActiveMarkdownMatchSelection(nextActiveIndex: number, writingId: string) {
    if (markdownSelectionOwnerId(currentWritingIdRef.current) !== writingId) {
      return
    }

    const textarea = markdownTextareaRef.current
    const targetMatch = markdownFindMatches[clampFindReplaceIndex(markdownFindMatches.length, nextActiveIndex)]

    if (!textarea || !targetMatch) {
      return
    }

    textarea.focus()
    textarea.setSelectionRange(targetMatch.start, targetMatch.end)
    markdownSelectionRef.current = {
      start: targetMatch.start,
      end: targetMatch.end,
      text: textarea.value.slice(targetMatch.start, targetMatch.end),
      writingId,
    }
  }

  const navigateFindMatches = useCallback(
    (direction: 1 | -1) => {
      if (matchCount === 0) {
        return
      }

      const nextActiveIndex = resolveNextFindReplaceIndex(matchCount, activeMatchIndex, direction)
      setFindActiveIndex(nextActiveIndex)

      if (modeRef.current === "markdown") {
        const writingId = markdownSelectionOwnerId(currentWritingId)
        window.requestAnimationFrame(() => {
          syncActiveMarkdownMatchSelection(nextActiveIndex, writingId)
        })
        return
      }

      syncActiveRichMatchSelection(nextActiveIndex)
    },
    [activeMatchIndex, currentWritingId, markdownSelectionOwnerId, matchCount, modeRef, setFindActiveIndex, syncActiveMarkdownMatchSelection, syncActiveRichMatchSelection],
  )

  const handleReplaceCurrentMatch = useCallback(() => {
    if (!findQuery.trim()) {
      return
    }

    if (modeRef.current === "markdown") {
      const currentMatch = markdownFindMatches[activeMatchIndex]

      if (!currentMatch) {
        return
      }

      const nextMarkdown = replaceMatchInText(markdownValue, currentMatch, replaceValue)
      const nextMatches = findTextMatches(nextMarkdown, findQuery, findCaseSensitive)
      const nextActive = clampFindReplaceIndex(nextMatches.length, activeMatchIndex)

      handleMarkdownChange(nextMarkdown)
      setFindActiveIndex(nextActive)

      const writingId = markdownSelectionOwnerId(currentWritingId)
      window.requestAnimationFrame(() => {
        syncActiveMarkdownMatchSelection(nextActive, writingId)
      })
      return
    }

    if (!editor) {
      return
    }

    const currentMatch = richFindMatches[activeMatchIndex]

    if (!currentMatch) {
      return
    }

    const transaction = editor.state.tr.insertText(replaceValue, currentMatch.from, currentMatch.to)
    editor.view.dispatch(transaction)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)

    const nextActive = clampFindReplaceIndex(findDocumentMatches(editor.state.doc, findQuery, findCaseSensitive).length, activeMatchIndex)
    setFindActiveIndex(nextActive)
    syncActiveRichMatchSelection(nextActive)
  }, [
    activeMatchIndex,
    currentWritingId,
    editor,
    findCaseSensitive,
    findQuery,
    handleMarkdownChange,
    markdownFindMatches,
    markdownSelectionOwnerId,
    markdownValue,
    modeRef,
    persistEditorSnapshot,
    replaceValue,
    richFindMatches,
    setFindActiveIndex,
    syncActiveMarkdownMatchSelection,
    syncActiveRichMatchSelection,
    updateDerivedEditorState,
  ])

  const handleReplaceAllMatches = useCallback(() => {
    if (!findQuery.trim() || matchCount === 0) {
      return
    }

    const confirmation = window.confirm(`Replace ${matchCount} matches with "${replaceValue}"?`)

    if (!confirmation) {
      return
    }

    if (modeRef.current === "markdown") {
      const result = replaceAllMatchesInText(markdownValue, findQuery, replaceValue, findCaseSensitive)
      handleMarkdownChange(result.value)
      setFindActiveIndex(0)
      return
    }

    if (!editor) {
      return
    }

    if (richFindMatches.length === 0) {
      return
    }

    const transaction = editor.state.tr

    for (let index = richFindMatches.length - 1; index >= 0; index -= 1) {
      const match = richFindMatches[index]
      transaction.insertText(replaceValue, match.from, match.to)
    }

    editor.view.dispatch(transaction)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)
    setFindActiveIndex(0)
  }, [
    editor,
    findCaseSensitive,
    findQuery,
    handleMarkdownChange,
    markdownValue,
    matchCount,
    modeRef,
    persistEditorSnapshot,
    replaceValue,
    richFindMatches,
    setFindActiveIndex,
    updateDerivedEditorState,
  ])

  return {
    activeMatchIndex,
    closeFindReplacePanel,
    handleReplaceAllMatches,
    handleReplaceCurrentMatch,
    markdownOverlayHtml,
    matchCount,
    navigateFindMatches,
    openFindReplacePanel,
  }
}
