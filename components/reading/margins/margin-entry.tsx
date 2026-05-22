"use client"

import { useState, useRef, useEffect } from "react"
import { Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"

export type MarginData = {
  id: string
  anchor_start: number
  anchor_end: number
  anchor_text: string
  note: string | null
  shared: boolean
  shared_at: string | null
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
}

export function MarginEntry({
  margin,
  focused,
  onFocus,
  onBlur,
  onUpdateNote,
  onDelete,
  onToggleShare,
}: MarginEntryProps) {
  const [noteValue, setNoteValue] = useState(margin.note ?? "")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync external changes
  useEffect(() => {
    setNoteValue(margin.note ?? "")
  }, [margin.note])

  function handleNoteBlur() {
    onBlur()
    const trimmed = noteValue.trim()
    const newNote = trimmed === "" ? null : trimmed
    if (newNote !== margin.note) {
      onUpdateNote(margin.id, newNote)
    }
  }

  const hasNote = !!(margin.note || noteValue.trim())
  const borderColor = focused ? "var(--cursor)" : hasNote ? "hsl(35,80%,55%)" : "transparent"

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
        <p className="font-lora italic text-[12px] text-ink-4 leading-relaxed line-clamp-2">
          &ldquo;{margin.anchor_text}&rdquo;
        </p>
        {onToggleShare && (
          <div className="flex items-center gap-1.5 shrink-0">
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
          </div>
        )}
      </div>

      {/* Note textarea */}
      <textarea
        ref={textareaRef}
        value={noteValue}
        onChange={(e) => setNoteValue(e.target.value)}
        onFocus={onFocus}
        onBlur={handleNoteBlur}
        placeholder="Add a note…"
        rows={noteValue ? undefined : 1}
        className="w-full resize-none bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 focus:outline-none"
        style={{ border: "none", minHeight: 20 }}
        aria-label="Margin annotation"
      />

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
