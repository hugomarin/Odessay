"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

type EditorFindReplaceProps = {
  searchValue: string
  replaceValue: string
  caseSensitive: boolean
  matchCount: number
  activeMatchNumber: number
  onSearchChange: (value: string) => void
  onReplaceChange: (value: string) => void
  onToggleCaseSensitive: () => void
  onNavigatePrevious: () => void
  onNavigateNext: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
  searchInputRef?: RefObject<HTMLInputElement | null>
  replaceInputRef?: RefObject<HTMLInputElement | null>
}

const controlButtonClass =
  "inline-flex h-8 items-center justify-center rounded-[8px] border border-border bg-[hsl(var(--bg))] px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted hover:text-ink"

const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-border bg-[hsl(var(--bg))] text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-transparent disabled:text-ink-4 disabled:opacity-100"

const inputClass =
  "h-full w-full border-none bg-transparent px-0 text-[13px] text-ink outline-none placeholder:text-ink-4/95"

const rowInputWrapClass = "flex h-11 min-w-0 flex-1 items-center gap-2 px-4"
const controlsRailClass = "flex w-[420px] shrink-0 items-center justify-end gap-2 px-4"
const PANEL_FIXED_GAP = 10

export function EditorFindReplace({
  searchValue,
  replaceValue,
  caseSensitive,
  matchCount,
  activeMatchNumber,
  onSearchChange,
  onReplaceChange,
  onToggleCaseSensitive,
  onNavigatePrevious,
  onNavigateNext,
  onReplaceOne,
  onReplaceAll,
  onClose,
  searchInputRef,
  replaceInputRef,
}: EditorFindReplaceProps) {
  const hasMatches = matchCount > 0
  const statusLabel = hasMatches ? `${activeMatchNumber} of ${matchCount}` : searchValue.trim() ? "No matches" : ""
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const [fixedLayout, setFixedLayout] = useState<{
    top: number
    left: number
    width: number
    height: number
  }>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  })

  useEffect(() => {
    const wrapper = wrapperRef.current
    const panel = panelRef.current
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')

    if (!wrapper || !panel || !editorViewport) {
      return
    }

    const updateLayout = () => {
      const topbar = document.querySelector<HTMLElement>('[data-testid="editor-topbar"]')
      const wrapperRect = wrapper.getBoundingClientRect()
      const panelHeight = panel.offsetHeight
      const fixedTop = (topbar?.getBoundingClientRect().bottom ?? 46) + PANEL_FIXED_GAP

      setFixedLayout((current) => {
        const nextState = {
          top: fixedTop,
          left: wrapperRect.left,
          width: wrapperRect.width,
          height: panelHeight,
        }

        if (
          current.top === nextState.top &&
          current.left === nextState.left &&
          current.width === nextState.width &&
          current.height === nextState.height
        ) {
          return current
        }

        return nextState
      })
    }

    updateLayout()

    editorViewport.addEventListener("scroll", updateLayout, { passive: true })
    window.addEventListener("resize", updateLayout)

    return () => {
      editorViewport.removeEventListener("scroll", updateLayout)
      window.removeEventListener("resize", updateLayout)
    }
  }, [])

  return (
    <div
      ref={wrapperRef}
      className="relative"
      style={{ height: fixedLayout.height || undefined }}
    >
      <section
        ref={panelRef}
        aria-label="Find and replace"
        className="fixed z-40 overflow-visible rounded-[10px] border border-border/80 bg-sb/96 shadow-float-md backdrop-blur supports-[backdrop-filter]:bg-sb/92"
        style={{
          top: fixedLayout.top,
          left: fixedLayout.left,
          width: fixedLayout.width,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-3 -top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/70 bg-sb/92 text-ink-4/80 shadow-float transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close find and replace"
        >
          <X className="h-3 w-3" strokeWidth={1.5} />
        </button>

        <div className="flex min-h-0 flex-col">
          <div className="flex min-h-[44px] items-center gap-3 border-b border-border/80">
            <div className={rowInputWrapClass}>
              <Search className="h-[14px] w-[14px] shrink-0 text-ink-4" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
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
                  className={inputClass}
                  placeholder="Type to search…"
                  aria-label="Find text"
                />
              </div>
            </div>

            <div className={cn(controlsRailClass, "text-ink-4")} aria-live="polite">
              <span className="min-w-[90px] text-right text-[12px] leading-none tabular-nums">{statusLabel}</span>

              <button
                type="button"
                onClick={onNavigatePrevious}
                className={iconButtonClass}
                disabled={!hasMatches}
                aria-label="Previous match"
              >
                <ChevronLeft className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>

              <button
                type="button"
                onClick={onNavigateNext}
                className={iconButtonClass}
                disabled={!hasMatches}
                aria-label="Next match"
              >
                <ChevronRight className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>

              <button
                type="button"
                onClick={onToggleCaseSensitive}
                className={cn(
                  controlButtonClass,
                  caseSensitive ? "border-border bg-muted text-ink" : "",
                )}
                aria-pressed={caseSensitive}
              >
                Match case
              </button>
            </div>
          </div>

          <div className="flex min-h-[44px] items-center gap-3">
            <div className={rowInputWrapClass}>
              <Search className="h-[14px] w-[14px] shrink-0 text-ink-4" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
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
                  placeholder="Replace with…"
                  aria-label="Replace text"
                />
              </div>
            </div>

            <div className={controlsRailClass}>
              <div className="w-[90px]" />
              <div className="w-8" />
              <div className="w-8" />
              <button type="button" onClick={onReplaceOne} className="inline-flex h-8 min-w-[116px] items-center justify-center rounded-[8px] border border-border bg-[hsl(var(--bg))] px-3 text-[12px] font-medium text-ink transition-colors hover:bg-muted hover:border-border/90 disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-transparent disabled:text-ink-4 disabled:opacity-100" disabled={!hasMatches}>
                Replace
              </button>

              <button type="button" onClick={onReplaceAll} className="inline-flex h-8 min-w-[116px] items-center justify-center rounded-[8px] border border-border bg-[hsl(var(--bg))] px-3 text-[12px] font-medium text-ink transition-colors hover:bg-muted hover:border-border/90 disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-transparent disabled:text-ink-4 disabled:opacity-100" disabled={!hasMatches}>
                Replace all
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
