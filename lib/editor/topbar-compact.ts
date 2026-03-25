import type { EditorShortcutAction } from "@/lib/editor/shortcuts"

export const EDITOR_TOPBAR_COMPACT_TRIGGER_ID = "editor-format-menu-trigger"

export const EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS =
  "hidden items-center gap-0.5 px-1 transition-opacity min-[960px]:flex"

export const EDITOR_TOPBAR_COMPACT_FORMAT_CLASS = "min-[960px]:hidden"

export const EDITOR_TOPBAR_TITLE_CONTAINER_CLASS =
  "pointer-events-none absolute inset-x-0 flex justify-center px-[88px] min-[960px]:px-[280px]"

type PreventableEvent = {
  preventDefault?: () => void
}

export const runCompactTopbarAction = (
  onRunAction: (action: EditorShortcutAction) => void,
  action: EditorShortcutAction,
  event?: PreventableEvent,
) => {
  event?.preventDefault?.()
  onRunAction(action)
}
