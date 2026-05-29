"use client"

import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import { open, save } from "@tauri-apps/plugin-dialog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

type Handlers = {
  onOpenFile: (path: string, content: string) => void
  onNewFile: (path: string) => void
}

export function useTauriMenuEvents({ onOpenFile, onNewFile }: Handlers) {
  const onOpenFileRef = useRef(onOpenFile)
  const onNewFileRef = useRef(onNewFile)

  // Keep refs current without re-registering Tauri listeners
  useEffect(() => { onOpenFileRef.current = onOpenFile }, [onOpenFile])
  useEffect(() => { onNewFileRef.current = onNewFile }, [onNewFile])

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

    return () => {
      cancelled = true
      unlisteners.forEach((ul) => ul())
    }
  }, []) // register once on mount — callbacks accessed via refs
}
