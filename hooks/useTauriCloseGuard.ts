"use client"

import { useEffect, useRef } from "react"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

/**
 * Intercepts the desktop window's close request so a still-pending or
 * in-flight local save is never abandoned just because the user quit the
 * app or closed the window. ODE-478 case 5 already made closing a single
 * tab wait for its save; nothing previously covered the window itself
 * (verified: no beforeunload/CloseRequested handler existed anywhere).
 *
 * `onBeforeClose` should flush any not-yet-submitted edit (e.g. a queued
 * rich-mode update) and then settle every pending write before resolving.
 * Uses Tauri v2's window.destroy() to close without re-triggering
 * onCloseRequested a second time.
 */
export function useTauriCloseGuard(onBeforeClose: () => Promise<unknown>) {
  const onBeforeCloseRef = useRef(onBeforeClose)
  useEffect(() => {
    onBeforeCloseRef.current = onBeforeClose
  }, [onBeforeClose])

  useEffect(() => {
    if (!isDesktopRuntime()) {
      return
    }

    let unlisten: (() => void) | undefined
    let cancelled = false
    let closing = false

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        if (cancelled) return
        const appWindow = getCurrentWindow()
        unlisten = await appWindow.onCloseRequested(async (event) => {
          if (closing) {
            return
          }
          event.preventDefault()
          closing = true
          try {
            await onBeforeCloseRef.current()
          } finally {
            await appWindow.destroy()
          }
        })
      } catch {
        // isDesktopRuntime() can be true without a real Tauri window behind
        // it (e.g. a test harness simulating desktop) — degrade to no guard
        // rather than an unhandled rejection.
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])
}
