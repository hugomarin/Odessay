"use client"

import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { open, save } from "@tauri-apps/plugin-dialog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

type Handlers = {
  onOpenFile: (path: string, content: string) => void
  onNewFile: (path: string) => void
}

export function useTauriMenuEvents({ onOpenFile, onNewFile }: Handlers) {
  useEffect(() => {
    if (!isDesktopRuntime()) return

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
      onOpenFile(path, content)
    }).then((ul) => unlisteners.push(ul))

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
      onNewFile(path)
    }).then((ul) => unlisteners.push(ul))

    return () => unlisteners.forEach((ul) => ul())
  }, [onOpenFile, onNewFile])
}
