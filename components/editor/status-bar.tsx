"use client"

import { memo } from "react"
import { AlignLeft } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { EditorSaveState } from "@/components/editor/save-state"
import type { SelectionMetrics, TextMetrics } from "@/lib/editor/text-metrics"

type StatusBarProps = {
  mode: "rich" | "markdown"
  metrics: TextMetrics
  selectionMetrics: SelectionMetrics | null
  saveState: EditorSaveState
  isNotesPanelOpen: boolean
  onToggleMode: (mode: "rich" | "markdown") => void
  onToggleNotesPanel: () => void
}

const SAVE_STATE_LABELS: Record<EditorSaveState, string> = {
  saved: "Saved",
  saving: "Saving...",
  "saved-local": "Saved locally",
}

const SAVE_STATE_COLORS: Record<EditorSaveState, string> = {
  saved: "text-ink-4",
  saving: "text-ink-3",
  "saved-local": "text-ink-4",
}

function formatMetrics(metrics: TextMetrics): string {
  const { words, characters, sentences, readingTimeMinutes, pages } = metrics
  return `${words.toLocaleString()} words · ${characters.toLocaleString()} chars · ${sentences.toLocaleString()} sentences · ${readingTimeMinutes} min · ${pages} pg`
}

function formatSelectionMetrics(metrics: SelectionMetrics): string {
  return `${metrics.words.toLocaleString()} words · ${metrics.characters.toLocaleString()} chars selected`
}

function StatusBarInner({
  mode,
  metrics,
  selectionMetrics,
  saveState,
  isNotesPanelOpen,
  onToggleMode,
  onToggleNotesPanel,
}: StatusBarProps) {
  const metricsLabel = selectionMetrics ? formatSelectionMetrics(selectionMetrics) : formatMetrics(metrics)

  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="editor-statusbar"
        data-section="editor-statusbar"
        data-testid="editor-statusbar"
        style={{ left: "var(--app-shell-left-offset, 0px)" }}
        className="EditorStatusbar fixed right-0 bottom-0 z-20 grid h-8 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-t-[0.5px] border-border/80 bg-bg/95 px-4 text-[11px] text-ink-4 backdrop-blur supports-[backdrop-filter]:bg-bg/85"
      >
        <p className={cn("min-w-0 truncate", SAVE_STATE_COLORS[saveState])} aria-live="polite">
          {SAVE_STATE_LABELS[saveState]}
        </p>
        <div className="justify-self-center">
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[7px] bg-muted p-[3px]">
            <button
              type="button"
              onClick={() => onToggleMode("rich")}
              className={cn(
                "h-[22px] rounded-[5px] px-[10px] font-medium whitespace-nowrap transition-[background,color] duration-[180ms] ease-in-out",
                mode === "rich"
                  ? "bg-white text-ink-2 shadow-[0_1px_3px_0_hsla(25,18%,12%,0.08)]"
                  : "bg-transparent text-ink-4 hover:text-ink",
              )}
            >
              Rich
            </button>
            <button
              type="button"
              onClick={() => onToggleMode("markdown")}
              className={cn(
                "h-[22px] rounded-[5px] px-[10px] font-medium whitespace-nowrap transition-[background,color] duration-[180ms] ease-in-out",
                mode === "markdown"
                  ? "bg-white text-ink-2 shadow-[0_1px_3px_0_hsla(25,18%,12%,0.08)]"
                  : "bg-transparent text-ink-4 hover:text-ink",
              )}
            >
              Markdown
            </button>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-self-end gap-2 overflow-hidden">
          <span
            className="truncate text-right transition-opacity duration-150"
            data-testid="editor-statusbar-metrics"
            title={metricsLabel}
          >
            {metricsLabel}
          </span>
          <ActionTooltip label="Notes panel" side="top">
            <button
              type="button"
              onClick={onToggleNotesPanel}
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition-[background-color,color] duration-150 ease-out",
                isNotesPanelOpen ? "bg-muted text-ink" : "text-ink-4 hover:bg-muted hover:text-ink",
              )}
              aria-label="Notes panel"
              aria-pressed={isNotesPanelOpen}
            >
              <AlignLeft className="h-[12px] w-[12px]" strokeWidth={1.8} />
            </button>
          </ActionTooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export const EditorStatusBar = memo(StatusBarInner)
