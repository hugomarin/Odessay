"use client"

import type { RefObject } from "react"
import { ChevronDown, ChevronUp, Replace, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

type EditorFindReplaceProps = {
  searchValue: string
  replaceValue: string
  caseSensitive: boolean
  replaceExpanded: boolean
  matchCount: number
  activeMatchNumber: number
  onSearchChange: (value: string) => void
  onReplaceChange: (value: string) => void
  onToggleCaseSensitive: () => void
  onToggleReplaceExpanded: () => void
  onNavigatePrevious: () => void
  onNavigateNext: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
  searchInputRef?: RefObject<HTMLInputElement | null>
  replaceInputRef?: RefObject<HTMLInputElement | null>
}

const buttonClass =
  "inline-flex h-8 items-center justify-center rounded-[8px] border-[0.5px] border-border/80 bg-sb px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted/70 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"

const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border/80 bg-sb text-ink-3 transition-colors hover:bg-muted/70 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"

const inputClass =
  "h-9 w-full rounded-[9px] border-[0.5px] border-border/80 bg-sb px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-cursor/55"

export function EditorFindReplace({
  searchValue,
  replaceValue,
  caseSensitive,
  replaceExpanded,
  matchCount,
  activeMatchNumber,
  onSearchChange,
  onReplaceChange,
  onToggleCaseSensitive,
  onToggleReplaceExpanded,
  onNavigatePrevious,
  onNavigateNext,
  onReplaceOne,
  onReplaceAll,
  onClose,
  searchInputRef,
  replaceInputRef,
}: EditorFindReplaceProps) {
  const hasMatches = matchCount > 0

  return (
    <div className="pointer-events-none sticky top-4 z-20 mb-4 flex justify-end">
      <section
        aria-label="Find and replace"
        className="pointer-events-auto w-full max-w-[420px] rounded-[12px] border-[0.5px] border-border/80 bg-sb/95 p-3 shadow-float-md backdrop-blur"
      >
        <div className="flex items-start gap-2">
          <div className="grid flex-1 gap-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ink-4" strokeWidth={1.5} />
                <input
                  ref={searchInputRef}
                  value={searchValue}
                  onChange={(event) => onSearchChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      if (event.shiftKey) {
                        onNavigatePrevious()
                      } else {
                        onNavigateNext()
                      }
                    }
                  }}
                  className={cn(inputClass, "pl-9")}
                  placeholder="Find in writing"
                  aria-label="Find text"
                />
              </div>

              <button
                type="button"
                onClick={onToggleReplaceExpanded}
                className={buttonClass}
                aria-pressed={replaceExpanded}
                aria-label="Toggle replace controls"
              >
                <Replace className="mr-1.5 h-[13px] w-[13px]" strokeWidth={1.5} />
                Replace
              </button>

              <button type="button" onClick={onClose} className={iconButtonClass} aria-label="Close find and replace">
                <X className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[72px] text-[12px] text-ink-4" aria-live="polite">
                {hasMatches ? `${activeMatchNumber} of ${matchCount}` : searchValue.trim() ? "No matches" : "Type to search"}
              </div>

              <button type="button" onClick={onNavigatePrevious} className={iconButtonClass} disabled={!hasMatches} aria-label="Previous match">
                <ChevronUp className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>

              <button type="button" onClick={onNavigateNext} className={iconButtonClass} disabled={!hasMatches} aria-label="Next match">
                <ChevronDown className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>

              <button
                type="button"
                onClick={onToggleCaseSensitive}
                className={cn(buttonClass, caseSensitive ? "border-cursor/50 bg-[hsl(var(--cursor)/0.12)] text-cursor" : "")}
                aria-pressed={caseSensitive}
              >
                Match case
              </button>
            </div>

            {replaceExpanded ? (
              <div className="grid gap-2 border-t border-border/70 pt-2">
                <input
                  ref={replaceInputRef}
                  value={replaceValue}
                  onChange={(event) => onReplaceChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      onReplaceOne()
                    }
                  }}
                  className={inputClass}
                  placeholder="Replace with"
                  aria-label="Replace text"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={onReplaceOne} className={buttonClass} disabled={!hasMatches}>
                    Replace one
                  </button>

                  <button type="button" onClick={onReplaceAll} className={buttonClass} disabled={!hasMatches}>
                    Replace all
                  </button>

                  {hasMatches ? (
                    <span className="text-[11px] text-ink-4">{matchCount} pending replacement{matchCount === 1 ? "" : "s"}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
