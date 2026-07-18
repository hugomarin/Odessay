"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUpRight, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { ANNOTATION_TYPE_COLOR } from "@/lib/editor/annotation-palette"

export type MarginData = {
  id: string
  anchor_start: number
  anchor_end: number
  anchor_text: string
  type: "personal" | "ai" | "highlight"
  text: string
  note?: string | null
  shared: boolean
  shared_at: string | null
  archived?: boolean
  resolved?: boolean
  created_at: string
}

type MarginEntryProps = {
  margin: MarginData
  focused: boolean
  onFocus: () => void
  onBlur: () => void
  onUpdateNote: (id: string, note: string | null) => void
  onDelete: (id: string) => void
  onToggleShare?: (id: string, shared: boolean) => void
  onScrollToText?: (anchorStart: number) => void
}

const COLLAPSED_LINE_COUNT = 3
const FALLBACK_LINE_HEIGHT = 20

export function MarginEntry({
  margin,
  focused,
  onFocus,
  onBlur,
  onUpdateNote,
  onDelete,
  onToggleShare,
  onScrollToText,
}: MarginEntryProps) {
  const [noteValue, setNoteValue] = useState(margin.text ?? margin.note ?? "")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [collapsedHeight, setCollapsedHeight] = useState(FALLBACK_LINE_HEIGHT)
  const [contentHeight, setContentHeight] = useState(FALLBACK_LINE_HEIGHT)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const effectiveExpanded = focused || isExpanded

  // Sync external changes
  useEffect(() => {
    setNoteValue(margin.text ?? margin.note ?? "")
  }, [margin.text, margin.note])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = "0px"
    const measuredScrollHeight = Math.max(textarea.scrollHeight, FALLBACK_LINE_HEIGHT)
    const computedStyles = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(computedStyles.lineHeight) || FALLBACK_LINE_HEIGHT
    const nextCollapsedHeight = Math.round(lineHeight * COLLAPSED_LINE_COUNT)
    textarea.style.height = ""

    setContentHeight(measuredScrollHeight)
    setCollapsedHeight(nextCollapsedHeight)
    setIsOverflowing(measuredScrollHeight > nextCollapsedHeight + 1)
  }, [noteValue])

  useEffect(() => {
    if (!isOverflowing && isExpanded) {
      setIsExpanded(false)
    }
  }, [isExpanded, isOverflowing])

  function handleNoteBlur() {
    onBlur()
    const trimmed = noteValue.trim()
    const newNote = trimmed === "" ? null : trimmed
    if (newNote !== (margin.text ?? margin.note ?? null)) {
      onUpdateNote(margin.id, newNote)
    }
  }

  const borderColor =
    focused
      ? "var(--cursor)"
      : ANNOTATION_TYPE_COLOR[margin.type]
  const typeLabel = margin.type === "ai" ? "AI" : margin.type === "highlight" ? "Highlight" : "Personal"
  const visibleHeight = noteValue.trim().length === 0
    ? FALLBACK_LINE_HEIGHT
    : effectiveExpanded
      ? contentHeight
      : Math.min(contentHeight, collapsedHeight)

  return (
    <div
      data-testid="margin-entry"
      data-margin-id={margin.id}
      className="group relative flex flex-col gap-2 rounded-[8px] px-3 py-3 transition-colors hover:bg-muted"
      style={{ borderLeft: `2.5px solid ${borderColor}`, marginLeft: -2.5 }}
      onMouseLeave={() => setShowDeleteConfirm(false)}
    >
      {/* Header: passage + share toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <span
            className="inline-flex rounded-[4px] px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase tracking-[0.07em]"
            style={{
              color: borderColor,
              backgroundColor: `color-mix(in srgb, ${borderColor} 8%, transparent)`,
            }}
          >
            {typeLabel}
          </span>
          <p className="font-lora italic text-[12px] text-ink-4 leading-relaxed line-clamp-2">
            &ldquo;{margin.anchor_text}&rdquo;
          </p>
        </div>
        {(onScrollToText || onToggleShare) && (
          <div className="flex items-center gap-1.5 shrink-0">
            {onScrollToText ? (
              <button
                type="button"
                onClick={() => onScrollToText(margin.anchor_start)}
                className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                aria-label="Scroll to annotated text"
                title="Scroll to annotated text"
              >
                <ArrowUpRight strokeWidth={1.5} className="h-[13px] w-[13px]" />
              </button>
            ) : null}
            {onToggleShare ? (
              <>
                <Switch
                  id={`margin-share-${margin.id}`}
                  checked={margin.shared}
                  onCheckedChange={(checked) => onToggleShare(margin.id, checked)}
                  aria-label={margin.shared ? "Shared with author" : "Private — toggle to share"}
                />
                <label
                  htmlFor={`margin-share-${margin.id}`}
                  className="sr-only"
                >
                  {margin.shared ? "Shared with author" : "Private"}
                </label>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Note textarea */}
      <textarea
        id={`margin-note-${margin.id}`}
        ref={textareaRef}
        value={noteValue}
        onChange={(e) => setNoteValue(e.target.value)}
        onFocus={onFocus}
        onBlur={handleNoteBlur}
        placeholder={margin.type === "ai" ? "Add an AI instruction…" : "Add a note…"}
        rows={1}
        className="w-full resize-none overflow-hidden bg-transparent font-sans text-[13px] leading-[1.65] text-ink-2 placeholder:text-ink-4 focus:outline-none"
        style={{ border: "none", minHeight: FALLBACK_LINE_HEIGHT, height: visibleHeight }}
        aria-label="Margin annotation"
      />

      {isOverflowing && !focused ? (
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="w-fit font-sans text-[11px] font-medium text-ink-3 transition-colors hover:text-ink"
          aria-expanded={isExpanded}
          aria-controls={`margin-note-${margin.id}`}
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      ) : null}

      {/* Delete action */}
      {showDeleteConfirm ? (
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span>Delete?</span>
          <button
            onClick={() => onDelete(margin.id)}
            className="font-medium text-destructive hover:underline"
          >
            Yes
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="hover:underline"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink-2 group-hover:flex"
          aria-label="Delete margin"
        >
          <Trash2 strokeWidth={1.5} className="h-[12px] w-[12px]" />
        </button>
      )}
    </div>
  )
}
