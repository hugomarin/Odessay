"use client"

import { useState } from "react"
import { MarginEntry, type MarginData } from "./margin-entry"

type MarginsPanelProps = {
  open: boolean
  margins: MarginData[]
  authorName: string | null
  writingId: string
  onUpdateNote: (id: string, note: string | null) => void
  onDelete: (id: string) => void
  onShare: () => void
  alreadyShared: boolean
}

export function MarginsPanel({
  open,
  margins,
  authorName,
  onUpdateNote,
  onDelete,
  onShare,
  alreadyShared,
}: MarginsPanelProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const sharedCount = margins.filter((m) => m.shared).length

  return (
    <div
      id="reading-margin-panel"
      data-section="reading-margin-panel"
      data-testid="reading-margin-panel"
      className="ReadingMarginPanel flex shrink-0 flex-col overflow-hidden border-l-[0.5px] border-border bg-bg"
      style={{
        width: open ? 296 : 0,
        transition: "width 300ms cubic-bezier(0.4,0,0.15,1)",
        opacity: open ? 1 : 0,
      }}
      aria-hidden={!open}
    >
      {open && (
        <>
          {/* Header */}
          <div className="flex h-[46px] shrink-0 items-center justify-between border-b-[0.5px] border-border px-4">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[13px] font-medium text-ink">Margins</span>
              {margins.length > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-muted px-1 font-sans text-[10px] text-ink-3">
                  {margins.length}
                </span>
              )}
            </div>
            {!alreadyShared && margins.length > 0 && authorName && (
              <button
                onClick={onShare}
                className="font-sans text-[12px] text-cursor transition-colors hover:underline"
                aria-label={`Share margins with ${authorName}`}
              >
                Share
              </button>
            )}
            {alreadyShared && (
              <span className="font-sans text-[11px] text-ink-4">Shared ({sharedCount})</span>
            )}
          </div>

          {/* Entries */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {margins.length === 0 ? (
              <p className="px-2 py-6 text-center font-lora italic text-[13px] text-ink-4">
                Select text to mark or annotate passages.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5 pl-[2.5px]">
                {margins.map((margin) => (
                  <MarginEntry
                    key={margin.id}
                    margin={margin}
                    focused={focusedId === margin.id}
                    onFocus={() => setFocusedId(margin.id)}
                    onBlur={() => setFocusedId(null)}
                    onUpdateNote={onUpdateNote}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer — share */}
          {margins.length > 0 && authorName && (
            <div className="shrink-0 border-t-[0.5px] border-border px-4 py-3">
              {alreadyShared ? (
                <p className="text-center font-sans text-[12px] text-ink-4">
                  Margins shared with {authorName}
                </p>
              ) : (
                <button
                  onClick={onShare}
                  className="w-full rounded-[8px] border-[0.5px] border-dashed border-border py-2 font-sans text-[12px] text-ink-3 transition-colors hover:border-cursor hover:text-ink-2"
                >
                  Share margins with {authorName}…
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
