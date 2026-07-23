"use client"

import { useEffect, useRef } from "react"
import { open, save } from "@tauri-apps/plugin-dialog"
import { subscribeMenuAction } from "@/lib/services/desktop/menu-event-bus"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

type Handlers = {
  onOpenFile: (path: string, content: string) => void
  onNewFile: (path: string) => void
  onEditorAction?: (action: EditorShortcutAction) => void
  onGetSaveContent?: () => { content: string; defaultName: string } | null
  /**
   * Performs the actual save-to-disk for the chosen path (ODE-402): the consumer
   * owns the physical move/write so the hook never leaves an untracked copy at
   * the destination. Returns the adopted canonical path (which may differ from
   * the requested one, e.g. a collision suffix) or `false` when the document did
   * not move — in that case the previous save target is kept so a later save
   * opens the picker again instead of writing to an untracked copy.
   */
  onSaveToDisk?: (path: string, content: string) => Promise<string | false> | string | false
  documentKey?: string | null
}

const EDITOR_MENU_ACTION_IDS: EditorShortcutAction[] = [
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
  "shortcutHelp",
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

export function useTauriMenuEvents({
  onOpenFile,
  onNewFile,
  onEditorAction,
  onGetSaveContent,
  onSaveToDisk,
  documentKey,
}: Handlers) {
  const onOpenFileRef = useRef(onOpenFile)
  const onNewFileRef = useRef(onNewFile)
  const onEditorActionRef = useRef(onEditorAction)
  const onGetSaveContentRef = useRef(onGetSaveContent)
  const onSaveToDiskRef = useRef(onSaveToDisk)
  const lastSavePathRef = useRef<string | null>(null)
  const isWritingRef = useRef(false)

  useEffect(() => { onOpenFileRef.current = onOpenFile }, [onOpenFile])
  useEffect(() => { onNewFileRef.current = onNewFile }, [onNewFile])
  useEffect(() => { onEditorActionRef.current = onEditorAction }, [onEditorAction])
  useEffect(() => { onGetSaveContentRef.current = onGetSaveContent }, [onGetSaveContent])
  useEffect(() => { onSaveToDiskRef.current = onSaveToDisk }, [onSaveToDisk])
  useEffect(() => { lastSavePathRef.current = null }, [documentKey])

  useEffect(() => {
    if (!isDesktopRuntime()) return

    const unsubscribers: Array<() => void> = []

    unsubscribers.push(
      subscribeMenuAction("open-file", async () => {
        const selected = await open({
          multiple: false,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        })
        if (!selected) return
        const path = typeof selected === "string" ? selected : selected[0]
        const { invoke } = await import("@tauri-apps/api/core")
        const content = await invoke<string>("open_file", { path })
        onOpenFileRef.current(path, content)
      }),
    )

    unsubscribers.push(
      subscribeMenuAction("new-file", async () => {
        const path = await save({
          defaultPath: "Untitled.md",
          filters: [{ name: "Markdown", extensions: ["md"] }],
        })
        if (!path) return
        const { invoke } = await import("@tauri-apps/api/core")
        const dir = path.substring(0, path.lastIndexOf("/"))
        const filename = path.substring(path.lastIndexOf("/") + 1)
        await invoke<string>("create_file", { dir, filename })
        onNewFileRef.current(path)
      }),
    )

    for (const action of EDITOR_MENU_ACTION_IDS) {
      unsubscribers.push(
        subscribeMenuAction(action, () => {
          onEditorActionRef.current?.(action)
        }),
      )
    }

    async function writeDocumentToDisk(forcePicker: boolean) {
      if (isWritingRef.current) return
      const payload = onGetSaveContentRef.current?.()
      if (!payload) return

      let path: string | null = null

      if (!forcePicker && lastSavePathRef.current) {
        path = lastSavePathRef.current
      } else {
        path = await save({
          defaultPath: `${payload.defaultName}.md`,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        })
        if (!path) return
      }

      if (!path.endsWith(".md")) {
        path = `${path}.md`
      }

      const finalPath = path
      isWritingRef.current = true
      try {
        if (onSaveToDiskRef.current) {
          // The consumer owns the physical move (ODE-402): a rename of the
          // canonical file, never a second copy written by this hook. Only a
          // confirmed move adopts the (possibly collision-suffixed) path as the
          // save target; `false` keeps the previous target so a later save
          // opens the picker again instead of writing to an untracked copy.
          const adopted = await onSaveToDiskRef.current(finalPath, payload.content)
          if (typeof adopted === "string" && adopted.length > 0) {
            lastSavePathRef.current = adopted
          }
        } else {
          const { invoke } = await import("@tauri-apps/api/core")
          await invoke("write_file", { path: finalPath, content: payload.content })
          lastSavePathRef.current = finalPath
        }
      } catch (err) {
        console.error("save-to-disk failed:", err)
      } finally {
        isWritingRef.current = false
      }
    }

    unsubscribers.push(
      subscribeMenuAction("save-to-disk", () => writeDocumentToDisk(false)),
    )
    unsubscribers.push(
      subscribeMenuAction("save-as", () => writeDocumentToDisk(true)),
    )

    const preventBrowserSaveShortcuts = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', preventBrowserSaveShortcuts, true)

    return () => {
      unsubscribers.forEach((unsub) => unsub())
      window.removeEventListener('keydown', preventBrowserSaveShortcuts, true)
    }
  }, []) // subscribe via global bus once on mount — callbacks accessed via refs
}
