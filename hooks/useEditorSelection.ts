"use client"

import { useMemo } from "react"
import type { Editor } from "@tiptap/react"
import { useEditorState } from "@tiptap/react"
import { calculateSelectionMetrics, type SelectionMetrics } from "@/lib/editor/text-metrics"

export type MarkdownSelectionSnapshot = {
  start: number
  end: number
  text: string
}

export function useEditorSelection(
  editor: Editor | null,
  mode: "rich" | "markdown",
  markdownSelection: MarkdownSelectionSnapshot | null,
): SelectionMetrics | null {
  const richSelectionText = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor || mode !== "rich") {
        return null
      }

      const { selection } = currentEditor.state

      if (selection.empty) {
        return null
      }

      return currentEditor.state.doc.textBetween(selection.from, selection.to, " ")
    },
  })

  const richMetrics = useMemo(() => {
    if (richSelectionText == null) {
      return null
    }
    return calculateSelectionMetrics(richSelectionText)
  }, [richSelectionText])

  const markdownMetrics = useMemo(() => {
    if (mode !== "markdown" || !markdownSelection || markdownSelection.start === markdownSelection.end) {
      return null
    }
    return calculateSelectionMetrics(markdownSelection.text)
  }, [mode, markdownSelection])

  return mode === "rich" ? richMetrics : markdownMetrics
}
