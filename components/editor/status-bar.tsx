import { cn } from "@/lib/utils"
import type { EditorSaveState } from "@/components/editor/save-state"

type StatusBarProps = {
  mode: "rich" | "markdown"
  wordCount: number
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

export function EditorStatusBar({ mode, wordCount, saveState, onToggleMode }: StatusBarProps) {
  return (
    <div
      id="editor-statusbar"
      data-section="editor-statusbar"
      data-testid="editor-statusbar"
      className="EditorStatusbar absolute bottom-0 left-0 right-0 flex h-8 items-center justify-between px-4 text-[11px] text-ink-4"
    >
      <p className={SAVE_STATE_COLORS[saveState]} aria-live="polite">
        {SAVE_STATE_LABELS[saveState]}
      </p>
      <div className="flex items-center gap-3">
        <span>{wordCount.toLocaleString()} words</span>
        <div className="inline-flex items-center gap-0.5 rounded-[7px] bg-muted p-[3px]">
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
