import { memo } from "react"
import { cn } from "@/lib/utils"
import type { EditorSaveState } from "@/components/editor/save-state"
import type { SelectionMetrics, TextMetrics } from "@/lib/editor/text-metrics"

type StatusBarProps = {
  mode: "rich" | "markdown"
  metrics: TextMetrics
  selectionMetrics: SelectionMetrics | null
  saveState: EditorSaveState
  onToggleMode: (mode: "rich" | "markdown") => void
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

function StatusBarInner({ mode, metrics, selectionMetrics, saveState, onToggleMode }: StatusBarProps) {
  const metricsLabel = selectionMetrics ? formatSelectionMetrics(selectionMetrics) : formatMetrics(metrics)

  return (
    <div
      id="editor-statusbar"
      data-section="editor-statusbar"
      data-testid="editor-statusbar"
      style={{ left: "var(--app-shell-left-offset, 0px)" }}
      className="EditorStatusbar fixed right-0 bottom-0 z-20 flex h-8 items-center justify-between border-t-[0.5px] border-border/80 bg-bg/95 px-4 text-[11px] text-ink-4 backdrop-blur supports-[backdrop-filter]:bg-bg/85"
    >
      <p className={SAVE_STATE_COLORS[saveState]} aria-live="polite">
        {SAVE_STATE_LABELS[saveState]}
      </p>
      <div className="flex items-center gap-3 overflow-hidden">
        <span
          className="truncate transition-opacity duration-150"
          data-testid="editor-statusbar-metrics"
          title={metricsLabel}
        >
          {metricsLabel}
        </span>
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
    </div>
  )
}

export const EditorStatusBar = memo(StatusBarInner)
