"use client"

import type { Editor } from "@tiptap/react"
import { EditorContent } from "@tiptap/react"
import { useLayoutEffect, useMemo, useRef } from "react"
import type { CSSProperties, ReactNode, RefObject, UIEvent } from "react"
import { renderMarkdownSemanticHtml } from "@/lib/editor/markdown-format"
import { cn } from "@/lib/utils"

type EditorContentProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  markdownValue: string
  onMarkdownChange: (markdown: string) => void
  onMarkdownSelectionChange?: (selection: { start: number; end: number; text: string }) => void
  markdownTextareaRef?: RefObject<HTMLTextAreaElement | null>
  topSlot?: ReactNode
  markdownOverlayHtml?: string
  sourceTransitionError?: string | null
  onRetrySourceConversion?: () => void
  onKeepEditingInSource?: () => void
  onRichLayoutReady?: () => void
}

export function WritingEditorContent({
  editor,
  mode,
  markdownValue,
  onMarkdownChange,
  onMarkdownSelectionChange,
  markdownTextareaRef,
  topSlot,
  markdownOverlayHtml,
  sourceTransitionError,
  onRetrySourceConversion,
  onKeepEditingInSource,
  onRichLayoutReady,
}: EditorContentProps) {
  const markdownSemanticRef = useRef<HTMLPreElement | null>(null)
  const richContentRef = useRef<HTMLDivElement | null>(null)
  const semanticHtml = useMemo(
    () => markdownOverlayHtml ?? renderMarkdownSemanticHtml(markdownValue),
    [markdownOverlayHtml, markdownValue],
  )

  useLayoutEffect(() => {
    if (mode !== "rich" || !editor || editor.isDestroyed) return

    const surface = richContentRef.current
    if (!surface) return

    const reportReadyLayout = (width: number, height: number) => {
      const editorElement = editor.view?.dom
      if (!editorElement) return
      if (
        !surface.isConnected ||
        !editorElement.isConnected ||
        !surface.contains(editorElement) ||
        width <= 0 ||
        height <= 0
      ) {
        return
      }

      onRichLayoutReady?.()
    }

    const rect = surface.getBoundingClientRect()
    reportReadyLayout(rect.width, rect.height)

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === surface)
      if (entry) reportReadyLayout(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(surface)

    return () => observer.disconnect()
  }, [editor, mode, onRichLayoutReady])

  const handleMarkdownScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget

    if (markdownSemanticRef.current) {
      markdownSemanticRef.current.scrollTop = target.scrollTop
      markdownSemanticRef.current.scrollLeft = target.scrollLeft
    }
  }

  const emitMarkdownSelection = (element: HTMLTextAreaElement) => {
    onMarkdownSelectionChange?.({
      start: element.selectionStart,
      end: element.selectionEnd,
      text: element.value.slice(element.selectionStart, element.selectionEnd),
    })
  }

  return (
    <div
      id="editor-writing-area"
      data-section="editor-writing-area"
      data-testid="editor-writing-area"
      className="EditorWritingArea od-scroll min-h-0 flex-1 overflow-y-auto"
    >
      <div className="odessay-editor-sheet-frame relative">
        {topSlot ? <div className="odessay-sticky-slot">{topSlot}</div> : null}
        <div className="relative">
          {mode === "markdown" ? (
            <div className="odessay-markdown-shell relative min-h-[55vh] w-full">
              {sourceTransitionError ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="relative z-20 mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  <span>{sourceTransitionError}</span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      onClick={onRetrySourceConversion}
                      className="rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={onKeepEditingInSource}
                      className="rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Keep editing in Source
                    </button>
                  </div>
                </div>
              ) : null}
              <pre
                ref={markdownSemanticRef}
                aria-hidden="true"
                className="odessay-markdown-semantic pointer-events-none absolute inset-0 z-0 m-0 overflow-hidden whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: `${semanticHtml}\n` }}
              />
              <textarea
                ref={markdownTextareaRef}
                value={markdownValue}
                onChange={(event) => onMarkdownChange(event.target.value)}
                onScroll={handleMarkdownScroll}
                onSelect={(event) => emitMarkdownSelection(event.currentTarget)}
                onFocus={(event) => emitMarkdownSelection(event.currentTarget)}
                onKeyUp={(event) => emitMarkdownSelection(event.currentTarget)}
                onMouseUp={(event) => emitMarkdownSelection(event.currentTarget)}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                style={{ fieldSizing: "content" } as CSSProperties}
                className="odessay-markdown-source relative z-10 box-border min-h-[55vh] w-full max-w-full resize-none border-none bg-transparent outline-none"
                aria-label="Markdown source"
              />
            </div>
          ) : null}
          <div
            ref={richContentRef}
            aria-hidden={mode === "markdown" ? "true" : undefined}
            inert={mode === "markdown" ? true : undefined}
            className={cn(
              "EditorRichContent",
              "rounded-[8px] border-[0.5px] border-transparent bg-transparent",
              mode === "markdown" && "pointer-events-none invisible absolute inset-x-0 top-0",
            )}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}
