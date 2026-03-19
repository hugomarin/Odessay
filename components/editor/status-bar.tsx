import type { EditorSaveState } from "@/components/editor/save-state"

type StatusBarProps = {
  mode: "rich" | "markdown"
  wordCount: number
  saveState: EditorSaveState
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

export function EditorStatusBar({ mode, wordCount, saveState }: StatusBarProps) {
  return (
    <div
      id="editor-statusbar"
      data-section="editor-statusbar"
      data-testid="editor-statusbar"
      className="EditorStatusbar flex h-8 items-center justify-between border-t-[0.5px] border-border px-4 text-[11px] text-ink-4"
    >
      <p className={SAVE_STATE_COLORS[saveState]} aria-live="polite">
        {SAVE_STATE_LABELS[saveState]}
      </p>
      <div className="flex items-center gap-3">
        <span>{wordCount.toLocaleString()} words</span>
        <span>{mode === "markdown" ? "Markdown" : "Rich"}</span>
      </div>
    </div>
  )
}
