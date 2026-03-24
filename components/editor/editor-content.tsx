"use client"

import type { Editor } from "@tiptap/react"
import { EditorContent } from "@tiptap/react"
import type { RefObject } from "react"
import { cn } from "@/lib/utils"

type EditorContentProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  markdownValue: string
  onMarkdownChange: (markdown: string) => void
  markdownTextareaRef?: RefObject<HTMLTextAreaElement | null>
}

export function WritingEditorContent({
  editor,
  mode,
  markdownValue,
  onMarkdownChange,
  markdownTextareaRef,
}: EditorContentProps) {
  return (
    <div
      id="editor-writing-area"
      data-section="editor-writing-area"
      data-testid="editor-writing-area"
      className="EditorWritingArea min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-16 sm:px-10">
        {mode === "markdown" ? (
          <textarea
            ref={markdownTextareaRef}
            value={markdownValue}
            onChange={(event) => onMarkdownChange(event.target.value)}
            style={{ fieldSizing: "content" } as React.CSSProperties}
            className="box-border min-h-[55vh] w-full max-w-full resize-none border-none bg-transparent font-mono text-[18px] leading-[1.85] text-ink outline-none"
            aria-label="Markdown source"
          />
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
