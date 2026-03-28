"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import type { MarkdownFootnote } from "@/lib/editor/footnote-extension"

type NotesPanelProps = {
  footnotes: MarkdownFootnote[]
  onAddFootnote: (text: string) => void
  onUpdateFootnote: (index: number, text: string) => void
  onDeleteFootnote: (index: number) => void
  onClose: () => void
}

export function NotesPanel({
  footnotes,
  onAddFootnote,
  onUpdateFootnote,
  onDeleteFootnote,
  onClose,
}: NotesPanelProps) {
  const [nextNote, setNextNote] = useState("")
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  useEffect(() => {
    setDrafts(
      footnotes.reduce<Record<number, string>>((acc, footnote) => {
        acc[footnote.index] = footnote.text
        return acc
      }, {}),
    )
  }, [footnotes])

  const hasNotes = footnotes.length > 0
  const disabledAdd = nextNote.trim().length === 0

  const orderedFootnotes = useMemo(() => footnotes.slice().sort((a, b) => a.index - b.index), [footnotes])

  return (
    <aside
      id="editor-panel-notes"
      data-section="editor-panel-notes"
      data-testid="editor-panel-notes"
      className="EditorPanelNotes fixed right-0 top-[46px] bottom-8 z-40 w-[248px] border-l-[0.5px] border-border bg-sb"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Notes</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close notes panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex h-[calc(100%-46px)] flex-col">
        <div className="space-y-3 border-b-[0.5px] border-border p-4">
          <p className="text-[12px] text-ink-3">Add a footnote from this panel.</p>
          <textarea
            value={nextNote}
            onChange={(event) => setNextNote(event.target.value)}
            placeholder="Write the note text..."
            className="min-h-20 w-full resize-y rounded-md border-[0.5px] border-border bg-bg px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-ink"
          />
          <button
            type="button"
            onClick={() => {
              if (disabledAdd) {
                return
              }

              onAddFootnote(nextNote)
              setNextNote("")
            }}
            disabled={disabledAdd}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border-[0.5px] border-border bg-bg px-3 text-[12px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-[13px] w-[13px]" strokeWidth={1.5} />
            Add note
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!hasNotes ? (
            <p className="text-[12px] text-ink-4">No footnotes yet.</p>
          ) : (
            orderedFootnotes.map((footnote) => (
              <article
                key={footnote.index}
                className="space-y-2 rounded-md border-[0.5px] border-border bg-bg p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="font-lora text-[13px] text-ink">[{footnote.index}]</p>
                  <button
                    type="button"
                    onClick={() => onDeleteFootnote(footnote.index)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                    aria-label={`Delete note ${footnote.index}`}
                  >
                    <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />
                  </button>
                </div>

                <textarea
                  value={drafts[footnote.index] ?? ""}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setDrafts((current) => ({
                      ...current,
                      [footnote.index]: nextValue,
                    }))
                  }}
                  onBlur={() => {
                    const nextValue = drafts[footnote.index] ?? ""

                    if (nextValue !== footnote.text) {
                      onUpdateFootnote(footnote.index, nextValue)
                    }
                  }}
                  className="min-h-16 w-full resize-y rounded-md border-[0.5px] border-border bg-sb px-2.5 py-2 text-[13px] text-ink outline-none focus:border-ink"
                />
              </article>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}
