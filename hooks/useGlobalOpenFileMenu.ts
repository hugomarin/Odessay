"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { listen } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { setPendingOpenFile } from "@/lib/editor/pending-open-file"

/**
 * Mounted outside Write (e.g. desktop app shell). Handles Cmd+O when the user
 * isn't already in Write, where useTauriMenuEvents' own `menu:open-file`
 * listener takes over instead. Only one of the two listeners is ever active
 * for a given route, avoiding a duplicate native dialog.
 */
export function useGlobalOpenFileMenu() {
  const router = useRouter()
  const pathname = usePathname()
  const isWriteRoute = pathname?.startsWith("/write") ?? false

  useEffect(() => {
    if (!isDesktopRuntime() || isWriteRoute) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    listen("menu:open-file", async () => {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      })
      if (!selected) return
      const path = typeof selected === "string" ? selected : selected[0]
      const { invoke } = await import("@tauri-apps/api/core")
      const content = await invoke<string>("open_file", { path })
      setPendingOpenFile({ path, content })
      router.push("/write")
    }).then((ul) => {
      if (cancelled) { ul(); return }
      unlisten = ul
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [isWriteRoute, router])
}
