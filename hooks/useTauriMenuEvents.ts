"use client"

import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import { open, save } from "@tauri-apps/plugin-dialog"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

type Handlers = {
  onOpenFile: (path: string, content: string) => void
  onNewFile: (path: string) => void
  onEditorAction?: (action: EditorShortcutAction) => void
  onGetSaveContent?: () => { content: string; defaultName: string } | null
  onSaveComplete?: (path: string) => Promise<void> | void
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
  onSaveComplete,
  documentKey,
}: Handlers) {
  const onOpenFileRef = useRef(onOpenFile)
  const onNewFileRef = useRef(onNewFile)
  const onEditorActionRef = useRef(onEditorAction)
  const onGetSaveContentRef = useRef(onGetSaveContent)
  const onSaveCompleteRef = useRef(onSaveComplete)
  const lastSavePathRef = useRef<string | null>(null)
  const isWritingRef = useRef(false)

  useEffect(() => { onOpenFileRef.current = onOpenFile }, [onOpenFile])
  useEffect(() => { onNewFileRef.current = onNewFile }, [onNewFile])
  useEffect(() => { onEditorActionRef.current = onEditorAction }, [onEditorAction])
  useEffect(() => { onGetSaveContentRef.current = onGetSaveContent }, [onGetSaveContent])
  useEffect(() => { onSaveCompleteRef.current = onSaveComplete }, [onSaveComplete])
  useEffect(() => { lastSavePathRef.current = null }, [documentKey])

  useEffect(() => {
    if (!isDesktopRuntime()) return

    let cancelled = false
    const unlisteners: Array<() => void> = []

    listen("menu:open-file", async () => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      })
      if (!selected) return
      const path = typeof selected === "string" ? selected : selected[0]
      const { invoke } = await import("@tauri-apps/api/core")
      const content = await invoke<string>("open_file", { path })
      onOpenFileRef.current(path, content)
    }).then((ul) => {
      if (cancelled) { ul(); return }
      unlisteners.push(ul)
    })

    listen("menu:new-file", async () => {
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
    }).then((ul) => {
      if (cancelled) { ul(); return }
      unlisteners.push(ul)
    })

    for (const action of EDITOR_MENU_ACTION_IDS) {
      listen(`menu:${action}`, () => {
        onEditorActionRef.current?.(action)
      }).then((ul) => {
        if (cancelled) { ul(); return }
        unlisteners.push(ul)
      })
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
        const { invoke } = await import("@tauri-apps/api/core")
        await invoke("write_file", { path: finalPath, content: payload.content })
        lastSavePathRef.current = finalPath
        onSaveCompleteRef.current?.(finalPath)
      } catch (err) {
        console.error("write_file failed:", err)
      } finally {
        isWritingRef.current = false
      }
    }

    listen("menu:save-to-disk", () => writeDocumentToDisk(false)).then((ul) => {
      if (cancelled) { ul(); return }
      unlisteners.push(ul)
    })

    listen("menu:save-as", () => writeDocumentToDisk(true)).then((ul) => {
      if (cancelled) { ul(); return }
      unlisteners.push(ul)
    })

    const preventBrowserSaveShortcuts = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', preventBrowserSaveShortcuts, true)

    return () => {
      cancelled = true
      unlisteners.forEach((ul) => ul())
      window.removeEventListener('keydown', preventBrowserSaveShortcuts, true)
    }
  }, []) // register once on mount — callbacks accessed via refs
}
