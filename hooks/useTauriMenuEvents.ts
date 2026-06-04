"use client"

import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import { open, save } from "@tauri-apps/plugin-dialog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

type Handlers = {
  onOpenFile: (path: string, content: string) => void
  onNewFile: (path: string) => void
  onGetSaveContent?: () => { content: string; defaultName: string } | null
  onSaveComplete?: (path: string) => void
  lastSavePath?: string | null
}

export function useTauriMenuEvents({ onOpenFile, onNewFile, onGetSaveContent, onSaveComplete, lastSavePath }: Handlers) {
  const onOpenFileRef = useRef(onOpenFile)
  const onNewFileRef = useRef(onNewFile)
  const onGetSaveContentRef = useRef(onGetSaveContent)
  const onSaveCompleteRef = useRef(onSaveComplete)
  const lastSavePathRef = useRef(lastSavePath ?? null)

  // Keep refs current without re-registering Tauri listeners
  useEffect(() => { onOpenFileRef.current = onOpenFile }, [onOpenFile])
  useEffect(() => { onNewFileRef.current = onNewFile }, [onNewFile])
  useEffect(() => { onGetSaveContentRef.current = onGetSaveContent }, [onGetSaveContent])
  useEffect(() => { onSaveCompleteRef.current = onSaveComplete }, [onSaveComplete])
  useEffect(() => { lastSavePathRef.current = lastSavePath ?? null }, [lastSavePath])

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

    async function writeDocumentToDisk(forcePicker: boolean) {
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

      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("write_file", { path, content: payload.content })
      onSaveCompleteRef.current?.(path)
    }

    listen("menu:save-to-disk", () => writeDocumentToDisk(false)).then((ul) => {
      if (cancelled) { ul(); return }
      unlisteners.push(ul)
    })

    listen("menu:save-as", () => writeDocumentToDisk(true)).then((ul) => {
      if (cancelled) { ul(); return }
      unlisteners.push(ul)
    })

    return () => {
      cancelled = true
      unlisteners.forEach((ul) => ul())
    }
  }, []) // register once on mount — callbacks accessed via refs
}
