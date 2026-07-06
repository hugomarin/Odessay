"use client"

import { useEffect, useRef } from "react"
import { subscribeMenuAction } from "@/lib/services/desktop/menu-event-bus"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"

const EDITOR_MENU_ACTIONS: EditorShortcutAction[] = [
  "bold",
  "italic",
  "strike",
  "highlight",
  "inlineCode",
  "codeBlock",
  "link",
  "footnote",
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "blockquote",
  "bulletList",
  "orderedList",
  "focusMode",
  "settings",
  "table",
  "image",
  "find",
  "replace",
  "clearStyles",
  "horizontalRule",
  "copyAsMarkdown",
  "copyAsHtml",
  "date",
  "toggleSidebar",
  "toggleTopbar",
  "toggleTabBar",
]

export function useTauriEditorMenuEvents(onRunAction: (action: EditorShortcutAction) => void) {
  const onRunActionRef = useRef(onRunAction)
  useEffect(() => {
    onRunActionRef.current = onRunAction
  }, [onRunAction])

  useEffect(() => {
    if (!isDesktopRuntime()) return

    const unsubscribers = EDITOR_MENU_ACTIONS.map((action) =>
      subscribeMenuAction(action, () => {
        onRunActionRef.current(action)
      }),
    )

    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, []) // subscribe via global bus once on mount — callback accessed via ref
}
