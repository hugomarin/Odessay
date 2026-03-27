"use client"

import type { Editor } from "@tiptap/react"
import { EditorContent } from "@tiptap/react"
import { useMemo, useRef } from "react"
import type { CSSProperties, RefObject, UIEvent } from "react"
import { renderMarkdownSemanticHtml } from "@/lib/editor/markdown-format"
import { cn } from "@/lib/utils"

type EditorContentProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  markdownValue: string
  onMarkdownChange: (markdown: string) => void
  spellcheckEnabled: boolean
  autoCorrect: "on" | "off"
  autoCapitalize: "on" | "off"
  language: string
  markdownTextareaRef?: RefObject<HTMLTextAreaElement | null>
}

export function WritingEditorContent({
  editor,
  mode,
  markdownValue,
  onMarkdownChange,
  spellcheckEnabled,
  autoCorrect,
  autoCapitalize,
  language,
  markdownTextareaRef,
}: EditorContentProps) {
  const markdownSemanticRef = useRef<HTMLPreElement | null>(null)
  const semanticHtml = useMemo(() => renderMarkdownSemanticHtml(markdownValue), [markdownValue])

  const handleMarkdownScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget

    if (markdownSemanticRef.current) {
      markdownSemanticRef.current.scrollTop = target.scrollTop
      markdownSemanticRef.current.scrollLeft = target.scrollLeft
    }
  }

  return (
    <div
      id="editor-writing-area"
      data-section="editor-writing-area"
      data-testid="editor-writing-area"
      className="EditorWritingArea min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-16 sm:px-10">
        {mode === "markdown" ? (
          <div className="odessay-markdown-shell relative min-h-[55vh] w-full">
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
              spellCheck={spellcheckEnabled}
              autoCorrect={autoCorrect}
              autoCapitalize={autoCapitalize}
              lang={language}
              style={{ fieldSizing: "content" } as CSSProperties}
              className="odessay-markdown-source relative z-10 box-border min-h-[55vh] w-full max-w-full resize-none border-none bg-transparent outline-none"
              aria-label="Markdown source"
            />
          </div>
        ) : (
          <div
            className={cn(
              "EditorRichContent",
              "rounded-[8px] border-[0.5px] border-transparent bg-transparent",
              "focus-within:border-border/40",
            )}
          >
            <EditorContent editor={editor} />
          </div>
        )}
      </div>
    </div>
  )
}
