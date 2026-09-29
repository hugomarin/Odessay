"use client"

/**
 * El cableado de los footnotes del editor: el alta de una nota (Markdown o
 * Rich), la derivación de las anotaciones de footnote para el panel de notas y
 * el clic en una referencia (`FOOTNOTE_REF_EVENT`), que abre el panel `notes`.
 *
 * ODE-607 — corte 6, paso 3 de `components/editor/editor-shell.tsx`.
 * MUDANZA MECÁNICA: el efecto, `handleInsertFootnote` y el memo `footnotes`
 * son los que vivían en la shell, con las mismas dependencias (el memo
 * conserva `version || richFootnoteRevision`, fix de ODE-625); la propiedad
 * del estado NO cambia: el estado y los refs siguen siendo de la shell y
 * llegan por `input` (identidades estables, así que la memoización no
 * cambia). El hook se llama donde estaba `handleInsertFootnote`, así que el
 * orden de efectos no cambia: el efecto de `FOOTNOTE_REF_EVENT` (antes entre
 * `handleInsertLink` y `handleInsertTable`) solo pasa por detrás de
 * manejadores sin efectos, y sigue después de `useDocumentExit` y de
 * `useSelectionPopup`.
 *
 * `refreshRichFootnotes` se queda en la shell: sus consumidores
 * (`useExternalDocumentChanges` y `useDocumentHydration`) están declarados
 * antes del punto de llamada de este hook, así que moverlo exigiría reordenar
 * declaraciones. Ver la Recon correction del PR.
 *
 * Red: `tests/editor-shell-commands.test.tsx` (footnote rich y markdown),
 * `tests/footnote-extension.test.ts` y el resto de la suite `editor-shell-*`
 * pasan idénticas antes y después de esta mudanza.
 */
import { useCallback, useEffect, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react"
import { type Editor } from "@tiptap/react"

import { appendMarkdownFootnote, extractRichEditorAnnotations, getMarkdownFootnotes } from "@/lib/editor/footnote-extension"
import { FOOTNOTE_REF_EVENT } from "@/lib/editor/footnote-node"

export type FootnotesInput = {
  applyMarkdownFromPanel: (nextMarkdown: string) => boolean
  editor: Editor | null
  markdownValue: string
  mode: "rich" | "markdown"
  modeRef: RefObject<"rich" | "markdown">
  persistEditorSnapshot: (editorInstance: Editor) => Promise<boolean>
  richFootnoteRevision: number
  setActivePanel: (panel: "notes") => void
  setRichFootnoteRevision: Dispatch<SetStateAction<number>>
  updateDerivedEditorState: (editorInstance: Editor) => void
  version: number
}

export function useFootnotes(input: FootnotesInput) {
  const {
    applyMarkdownFromPanel,
    editor,
    markdownValue,
    mode,
    modeRef,
    persistEditorSnapshot,
    richFootnoteRevision,
    setActivePanel,
    setRichFootnoteRevision,
    updateDerivedEditorState,
    version,
  } = input

  useEffect(() => {
    const onFootnoteClick = () => {
      setActivePanel("notes")
    }

    window.addEventListener(FOOTNOTE_REF_EVENT, onFootnoteClick)

    return () => {
      window.removeEventListener(FOOTNOTE_REF_EVENT, onFootnoteClick)
    }
  }, [])

  const handleInsertFootnote = useCallback(
    (note: string) => {
      if (modeRef.current === "markdown") {
        const nextMarkdown = appendMarkdownFootnote(markdownValue, note)
        applyMarkdownFromPanel(nextMarkdown)
        setActivePanel("notes")
        return
      }

      if (!editor) {
        return
      }

      editor.commands.addFootnote(note)
      setRichFootnoteRevision((r) => r + 1)
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
      setActivePanel("notes")
    },
    [applyMarkdownFromPanel, editor, markdownValue, persistEditorSnapshot, updateDerivedEditorState],
  )

  // In Rich mode, derive footnotes from editor nodes only when content version changes.
  // In Markdown mode, parse from the raw markdown value.
  const footnotes = useMemo(() => {
    if (mode === "rich") {
      const contentRevision = version || richFootnoteRevision
      void contentRevision
      if (!editor) return []
      return extractRichEditorAnnotations(editor)
    }

    return getMarkdownFootnotes(markdownValue)
  }, [editor, markdownValue, mode, richFootnoteRevision, version])

  return { footnotes, handleInsertFootnote }
}
