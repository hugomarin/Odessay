"use client"

/**
 * El popup de selección rich y el bubble de anotación: qué se abre al
 * seleccionar texto, el enrutado de la acción elegida (marca personal, nota al
 * pie o anotación) y la reposición de ambas capas flotantes en `resize` y
 * `scroll`.
 *
 * ODE-607 — corte 6, paso 2 de `components/editor/editor-shell.tsx`.
 * MUDANZA MECÁNICA: los manejadores y los dos efectos son los que vivían en
 * la shell, con las mismas dependencias; la propiedad del estado NO cambia: el
 * estado y los refs siguen siendo de la shell y llegan por `input`
 * (identidades estables, así que la memoización no cambia). El hook se llama
 * donde estaba `dismissSelectionPopup`, así que el orden de efectos no cambia
 * (`selectionUpdate` antes que la reposición del overlay, y los dos después de
 * `useDocumentExit`). `getRichSelectionOverlayPositions` y
 * `captureRichSelectionSnapshot` se quedan en la shell porque
 * `useEditorCommands` los recibe antes de esta llamada; llegan por `input`.
 *
 * Red: `tests/editor-shell-selection-popup-actions.test.tsx`,
 * `tests/editor-shell-annotation-roundtrip.test.tsx` y `-desktop`,
 * `tests/editor-shell-selection-restore.test.tsx` (STATE-06/07) y el resto de
 * la suite `editor-shell-*` pasan idénticas antes y después de esta mudanza.
 */
import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react"
import { getMarkRange } from "@tiptap/core"
import { type Editor } from "@tiptap/react"

import { nextAnnotationSessionId, type AnnotationBubblePosition } from "@/components/reading/margins/annotation-bubble"
import { type SelectionPopupPosition } from "@/components/reading/margins/selection-popup"
import { type PendingAnnotationSnapshot, type PendingRichSelectionSnapshot } from "@/hooks/useEditorCommands"
import { type AnnotationType } from "@/lib/editor/footnote-node"
import { areFloatingOverlayAnchorsEqual } from "@/lib/reading/floating-overlay-position"

type SelectionSnapshot = {
  from: number
  to: number
  text: string
}

export type RichSelectionOverlayPositions = {
  popupPosition: SelectionPopupPosition
  bubblePosition: AnnotationBubblePosition
}

export type SelectionPopupInput = {
  captureRichSelectionSnapshot: () => PendingRichSelectionSnapshot | null
  editor: Editor | null
  getRichSelectionOverlayPositions: (from: number, to: number) => RichSelectionOverlayPositions | null
  modeRef: RefObject<"rich" | "markdown">
  pendingAnnotation: PendingAnnotationSnapshot | null
  pendingRichSelection: PendingRichSelectionSnapshot | null
  persistEditorSnapshot: (editorInstance: Editor) => Promise<boolean>
  selectionRef: RefObject<SelectionSnapshot | null>
  setActivePanel: (panel: "notes") => void
  setFootnoteModalOpen: Dispatch<SetStateAction<boolean>>
  setPendingAnnotation: Dispatch<SetStateAction<PendingAnnotationSnapshot | null>>
  setPendingRichSelection: Dispatch<SetStateAction<PendingRichSelectionSnapshot | null>>
  suppressNextSelectionPopupRef: RefObject<boolean>
  updateDerivedEditorState: (editorInstance: Editor) => void
}

export function useSelectionPopup(input: SelectionPopupInput) {
  const {
    captureRichSelectionSnapshot,
    editor,
    getRichSelectionOverlayPositions,
    modeRef,
    pendingAnnotation,
    pendingRichSelection,
    persistEditorSnapshot,
    selectionRef,
    setActivePanel,
    setFootnoteModalOpen,
    setPendingAnnotation,
    setPendingRichSelection,
    suppressNextSelectionPopupRef,
    updateDerivedEditorState,
  } = input

  const dismissSelectionPopup = useCallback(() => {
    suppressNextSelectionPopupRef.current = true
    setPendingRichSelection(null)
  }, [])

  const handleMarkSelection = useCallback(() => {
    if (!editor || !pendingRichSelection) {
      return
    }

    suppressNextSelectionPopupRef.current = true
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pendingRichSelection.from, to: pendingRichSelection.to })
      .setHighlight()
      .addAnnotation("highlight", "")
      .setTextSelection(pendingRichSelection.to)
      .run()

    setPendingRichSelection(null)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)
  }, [editor, pendingRichSelection, persistEditorSnapshot, updateDerivedEditorState])

  const convertStandaloneHighlight = useCallback(
    (anchorText: string, type: AnnotationType, text: string, anchorStart?: number, anchorEnd?: number, id?: string) => {
      if (!editor || !anchorText) return false
      const highlightMark = editor.schema.marks.highlight
      if (!highlightMark) return false

      let converted = false

      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "text") return
        if (!node.marks.some((m) => m.type.name === "highlight")) return
        const $pos = editor.state.doc.resolve(pos)
        const range = getMarkRange($pos, highlightMark)
        if (!range) return
        const highlightedText = editor.state.doc.textBetween(range.from, range.to)
        if (highlightedText === anchorText) {
          if (anchorStart !== undefined && anchorEnd !== undefined) {
            if (range.from !== anchorStart || range.to !== anchorEnd) return
          }
          converted = editor
            .chain()
            .focus()
            .setTextSelection({ from: range.from, to: range.to })
            .unsetHighlight()
            .setHighlight()
            .addAnnotation(type, text, id)
            .setTextSelection(range.to)
            .run()
          return false
        }
      })
      return converted
    },
    [editor],
  )

  const handleAnnotateSelection = useCallback(
    (annotationType: "personal" | "ai" | "footnote" = "footnote") => {
      if (!pendingRichSelection) return
      setPendingAnnotation({
        from: pendingRichSelection.from,
        to: pendingRichSelection.to,
        text: pendingRichSelection.text,
        position: pendingRichSelection.bubblePosition,
        sessionId: nextAnnotationSessionId(),
        annotationType,
      })
      setPendingRichSelection(null)
    },
    [pendingRichSelection],
  )

  const handleFootnoteSelection = useCallback(() => {
    if (!pendingRichSelection) {
      return
    }

    if (modeRef.current === "markdown") {
      setPendingRichSelection(null)
      setFootnoteModalOpen(true)
      return
    }

    selectionRef.current = {
      from: pendingRichSelection.from,
      to: pendingRichSelection.to,
      text: pendingRichSelection.text,
    }
    setPendingRichSelection(null)
    setFootnoteModalOpen(true)
  }, [pendingRichSelection])

  const handleEditorSelectType = useCallback(
    (type: "personal" | "ai" | "footnote") => {
      if (type === "personal") {
        handleMarkSelection()
        return
      }
      if (type === "footnote") {
        handleFootnoteSelection()
        return
      }
      handleAnnotateSelection(type)
    },
    [handleAnnotateSelection, handleFootnoteSelection, handleMarkSelection],
  )

  const handleConfirmAnnotation = useCallback(
    (note: string) => {
      if (!editor || !pendingAnnotation) return
      const trimmedNote = note.trim()
      if (!trimmedNote) return

      const annotationType = pendingAnnotation.annotationType ?? "footnote"
      suppressNextSelectionPopupRef.current = true

      if (annotationType === "footnote" || annotationType === "personal") {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: pendingAnnotation.from, to: pendingAnnotation.to })
          .setHighlight()
          .addFootnote(trimmedNote)
          .setTextSelection(pendingAnnotation.to)
          .run()
        setActivePanel("notes")
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: pendingAnnotation.from, to: pendingAnnotation.to })
          .setHighlight()
          .addAnnotation(annotationType, trimmedNote)
          .setTextSelection(pendingAnnotation.to)
          .run()
      }

      setPendingAnnotation(null)
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
    },
    [editor, pendingAnnotation, persistEditorSnapshot, updateDerivedEditorState],
  )

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleSelectionUpdate = () => {
      if (suppressNextSelectionPopupRef.current) {
        suppressNextSelectionPopupRef.current = false
        setPendingRichSelection(null)
        return
      }

      if (modeRef.current !== "rich" || pendingAnnotation) {
        return
      }

      const snapshot = captureRichSelectionSnapshot()
      if (!snapshot) {
        setPendingRichSelection(null)
        return
      }

      setPendingRichSelection((current) => {
        if (current && current.from === snapshot.from && current.to === snapshot.to) {
          return current
        }
        return snapshot
      })
    }

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [captureRichSelectionSnapshot, editor, pendingAnnotation])

  useEffect(() => {
    if (!editor || (!pendingRichSelection && !pendingAnnotation)) return

    const syncOpenOverlayPosition = (event?: Event) => {
      // ODE-409: `scroll` is listened to in the capture phase, so scrolling the
      // bubble's own textarea reaches this handler. The document geometry has
      // not moved in that case — recomputing it is pure churn.
      const eventTarget = event?.target
      if (
        eventTarget instanceof Element &&
        eventTarget.closest(".AnnotationBubble, .SelectionPopup")
      ) {
        return
      }

      if (pendingRichSelection) {
        const positions = getRichSelectionOverlayPositions(pendingRichSelection.from, pendingRichSelection.to)
        if (positions) {
          setPendingRichSelection((current) => {
            if (!current) return current
            if (
              areFloatingOverlayAnchorsEqual(current.popupPosition, positions.popupPosition) &&
              areFloatingOverlayAnchorsEqual(current.bubblePosition, positions.bubblePosition)
            ) {
              return current
            }
            return { ...current, ...positions }
          })
        }
      }

      if (pendingAnnotation) {
        const positions = getRichSelectionOverlayPositions(pendingAnnotation.from, pendingAnnotation.to)
        if (positions) {
          setPendingAnnotation((current) => {
            if (!current) return current
            if (areFloatingOverlayAnchorsEqual(current.position, positions.bubblePosition)) {
              return current
            }
            return { ...current, position: positions.bubblePosition }
          })
        }
      }
    }

    window.addEventListener("resize", syncOpenOverlayPosition)
    window.addEventListener("scroll", syncOpenOverlayPosition, { capture: true, passive: true })

    return () => {
      window.removeEventListener("resize", syncOpenOverlayPosition)
      window.removeEventListener("scroll", syncOpenOverlayPosition, { capture: true })
    }
  }, [editor, getRichSelectionOverlayPositions, pendingAnnotation, pendingRichSelection])

  return { convertStandaloneHighlight, dismissSelectionPopup, handleConfirmAnnotation, handleEditorSelectType }
}
