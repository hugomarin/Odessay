"use client"

import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
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

    let cancelled = false
    const unlisteners: Array<() => void> = []

    const promises = EDITOR_MENU_ACTIONS.map((action) =>
      listen(`menu:${action}`, () => {
        onRunActionRef.current(action)
      }).then((ul) => {
        if (cancelled) {
          ul()
          return
        }
        unlisteners.push(ul)
      }),
    )

    return () => {
      cancelled = true
      unlisteners.forEach((ul) => ul())
    }
  }, []) // register once on mount — callbacks accessed via refs
}
