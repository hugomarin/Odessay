import type { EditorShortcutAction } from "@/lib/editor/shortcuts"

export const EDITOR_TOPBAR_COMPACT_TRIGGER_ID = "editor-format-menu-trigger"

export const EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS =
  "hidden items-center gap-px px-0.5 transition-opacity min-[960px]:flex"

export const EDITOR_TOPBAR_COMPACT_FORMAT_CLASS = "min-[960px]:hidden"

export const EDITOR_TOPBAR_TITLE_CONTAINER_CLASS =
  "pointer-events-none mx-2 flex min-w-0 flex-1 justify-center"

type PreventableEvent = {
  preventDefault?: () => void
}

export type RichSelectionRange = {
  from: number
  to: number
}

export type RunEditorAction = (
  action: EditorShortcutAction,
  options?: { richSelection?: RichSelectionRange },
) => void

export const runCompactTopbarAction = (
  onRunAction: RunEditorAction,
  action: EditorShortcutAction,
  options?: {
    event?: PreventableEvent
    richSelection?: RichSelectionRange
  },
) => {
  options?.event?.preventDefault?.()
  onRunAction(action, options?.richSelection ? { richSelection: options.richSelection } : undefined)
}
