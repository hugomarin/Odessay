"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { open } from "@tauri-apps/plugin-dialog"
import { subscribeMenuAction } from "@/lib/services/desktop/menu-event-bus"
import { drainPendingOsOpenPaths } from "@/lib/services/desktop/pending-os-open"
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

    const unsubscribers: Array<() => void> = []

    unsubscribers.push(
      subscribeMenuAction("open-file", async () => {
        const selected = await open({
          multiple: false,
          fileAccessMode: "scoped",
          filters: [{ name: "Markdown", extensions: ["md"] }],
        })
        if (!selected) return
        const path = typeof selected === "string" ? selected : selected[0]
        const { invoke } = await import("@tauri-apps/api/core")
        const content = await invoke<string>("open_file", { path })
        setPendingOpenFile({ path, content })
        router.push("/write")
      }),
    )

    // A .md opened from Finder ("Open With") or dropped on the Dock icon
    // while we're not already in Write (see src-tauri/src/lib.rs
    // RunEvent::Opened) — queue it the same way as Cmd+O and hand off to
    // Write's own pending-file effect.
    const openFromOsPath = async (path: string) => {
      const { invoke } = await import("@tauri-apps/api/core")
      const content = await invoke<string>("open_file", { path })
      setPendingOpenFile({ path, content })
      router.push("/write")
    }
    unsubscribers.push(
      subscribeMenuAction("os-open-path", () => drainPendingOsOpenPaths(openFromOsPath)),
    )
    // Cold start: the OS may have queued the open before this listener
    // existed. Drain it once so that open isn't silently lost.
    void drainPendingOsOpenPaths(openFromOsPath)

    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [isWriteRoute, router])
}
