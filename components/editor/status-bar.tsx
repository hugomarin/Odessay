"use client"

import { memo } from "react"
import { AlignLeft, CloudUpload, Keyboard } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { EditorSaveState } from "@/components/editor/save-state"
import type { SelectionMetrics, TextMetrics } from "@/lib/editor/text-metrics"

/**
 * Status bar — 46px, edge to edge under the middle band, on the three-column
 * grid `minmax(0,1fr) auto minmax(0,1fr)` (docs/design/views/studio.md).
 * Left: save state. Center: the edit-mode segmented control. Right: metrics,
 * truncated from the right, then shortcuts and notes.
 */

type StatusBarProps = {
  mode: "rich" | "markdown"
  metrics: TextMetrics
  selectionMetrics: SelectionMetrics | null
  saveState: EditorSaveState
  isNotesPanelOpen: boolean
  onToggleMode: (mode: "rich" | "markdown") => void
  onToggleNotesPanel: () => void
  onOpenShortcutHelp: () => void
}

const SAVE_STATE_LABELS: Record<EditorSaveState, string> = {
  saved: "Saved",
  saving: "Saving...",
  "saved-local": "Saved locally",
  error: "Needs attention",
}

const SEGMENT_CLASS =
  "h-6 rounded-md px-[13px] text-xs font-medium whitespace-nowrap transition-[background-color,color] duration-[180ms] ease-in-out"

const STATUS_ICON_BUTTON_CLASS =
  "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150 ease-out"

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
  onOpenShortcutHelp,
}: StatusBarProps) {
  const metricsLabel = selectionMetrics ? formatSelectionMetrics(selectionMetrics) : formatMetrics(metrics)

  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="editor-statusbar"
        data-section="editor-statusbar"
        data-testid="editor-statusbar"
        className="EditorStatusbar grid h-[46px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-transparent px-3.5 font-sans"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CloudUpload
            className={cn("h-4 w-4 shrink-0", saveState === "error" ? "text-destructive" : "text-ink-4")}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p
            className={cn(
              "min-w-0 truncate text-[13px]",
              saveState === "error" ? "text-destructive" : "text-ink-3",
            )}
            aria-live="polite"
          >
            {SAVE_STATE_LABELS[saveState]}
          </p>
        </div>

        <div className="inline-flex items-center gap-0.5 justify-self-center rounded-lg bg-muted-hover p-[3px]">
          <button
            type="button"
            onClick={() => onToggleMode("rich")}
            className={cn(
              SEGMENT_CLASS,
              mode === "rich"
                ? "bg-sb text-ink shadow-[0_1px_2px_rgba(35,24,15,0.1)]"
                : "bg-transparent text-ink-4 hover:text-ink",
            )}
          >
            Rich
          </button>
          <button
            type="button"
            onClick={() => onToggleMode("markdown")}
            className={cn(
              SEGMENT_CLASS,
              mode === "markdown"
                ? "bg-sb text-ink shadow-[0_1px_2px_rgba(35,24,15,0.1)]"
                : "bg-transparent text-ink-4 hover:text-ink",
            )}
          >
            Markdown
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-2 justify-self-end overflow-hidden">
          <span
            className="min-w-0 flex-[0_1_auto] truncate text-right text-xs text-ink-4"
            data-testid="editor-statusbar-metrics"
            title={metricsLabel}
          >
            {metricsLabel}
          </span>
          <ActionTooltip
            label="Keyboard shortcuts"
            shortcut={getEditorShortcutLabel("shortcutHelp")}
            side="top"
          >
            <button
              type="button"
              onClick={onOpenShortcutHelp}
              className={cn(STATUS_ICON_BUTTON_CLASS, "text-ink-4 hover:bg-muted-hover hover:text-ink")}
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-[15px] w-[15px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>
          <ActionTooltip label="Notes panel" shortcut={getEditorShortcutLabel("addNote")} side="top">
            <button
              type="button"
              onClick={onToggleNotesPanel}
              className={cn(
                STATUS_ICON_BUTTON_CLASS,
                isNotesPanelOpen ? "bg-surface-selected text-ink" : "text-ink-4 hover:bg-muted-hover hover:text-ink",
              )}
              aria-label="Notes panel"
              aria-pressed={isNotesPanelOpen}
            >
              <AlignLeft className="h-[15px] w-[15px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export const EditorStatusBar = memo(StatusBarInner)
