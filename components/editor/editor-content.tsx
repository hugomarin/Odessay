"use client"

import { useLayoutEffect, useRef } from "react"
import type { Editor } from "@tiptap/react"
import { EditorContent } from "@tiptap/react"
import { cn } from "@/lib/utils"

type EditorContentProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  title: string
  markdownValue: string
  onTitleChange: (nextTitle: string) => void
  onTitleBlur: () => void
  onMarkdownChange: (markdown: string) => void
}

export function WritingEditorContent({
  editor,
  mode,
  title,
  markdownValue,
  onTitleChange,
  onTitleBlur,
  onMarkdownChange,
}: EditorContentProps) {
  const titleRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    if (!titleRef.current) {
      return
    }

    titleRef.current.style.height = "0px"
    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`
  }, [title])

  return (
    <div
      id="editor-writing-area"
      data-section="editor-writing-area"
      data-testid="editor-writing-area"
      className="EditorWritingArea min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-16 sm:px-10">
        <textarea
          ref={titleRef}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onTitleBlur}
          className="mb-8 block w-full resize-none overflow-hidden border-none bg-transparent font-lora text-[36px] font-medium leading-[1.18] tracking-[-0.01em] text-ink outline-none placeholder:text-ink-4 sm:text-[36px]"
          placeholder="Untitled writing"
          rows={1}
        />

        {mode === "markdown" ? (
          <textarea
            value={markdownValue}
            onChange={(event) => onMarkdownChange(event.target.value)}
            className="min-h-[55vh] w-full resize-y border-none bg-transparent font-mono text-[18px] leading-[1.85] text-ink outline-none"
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
