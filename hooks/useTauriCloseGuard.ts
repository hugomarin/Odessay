"use client"

import { useEffect, useRef } from "react"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

const activeEditorCloseGuards = new Set<symbol>()

export function hasActiveEditorCloseGuard() {
  return activeEditorCloseGuards.size > 0
}

/**
 * Intercepts the desktop window's close request so a still-pending or
 * in-flight local save is never abandoned just because the user quit the
 * app or closed the window. ODE-478 case 5 already made closing a single
 * tab wait for its save; nothing previously covered the window itself
 * (verified: no beforeunload/CloseRequested handler existed anywhere).
 *
 * `onBeforeClose` flushes any not-yet-submitted edit (e.g. a queued rich-mode
 * update), settles pending writes, then returns false when the user cancels a
 * data-loss confirmation. Uses Tauri v2's window.destroy() to close without
 * re-triggering onCloseRequested a second time.
 */
export function useTauriCloseGuard(
  onBeforeClose: () => Promise<void | boolean>,
  shouldHandleClose?: () => boolean,
  role: "editor" | "app" = "editor",
) {
  const onBeforeCloseRef = useRef(onBeforeClose)
  const shouldHandleCloseRef = useRef(shouldHandleClose)
  const closeGuardIdRef = useRef<symbol | null>(null)
  if (closeGuardIdRef.current === null) {
    closeGuardIdRef.current = Symbol("tauri-close-guard")
  }
  useEffect(() => {
    onBeforeCloseRef.current = onBeforeClose
  }, [onBeforeClose])
  useEffect(() => {
    shouldHandleCloseRef.current = shouldHandleClose
  }, [shouldHandleClose])
  useEffect(() => {
    if (role !== "editor") return

    const guardId = closeGuardIdRef.current
    if (!guardId) return
    activeEditorCloseGuards.add(guardId)
    return () => {
      activeEditorCloseGuards.delete(guardId)
    }
  }, [role])

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
          if (shouldHandleCloseRef.current && !shouldHandleCloseRef.current()) {
            return
          }
          if (closing) {
            return
          }
          event.preventDefault()
          closing = true
          try {
            const mayClose = await onBeforeCloseRef.current()
            if (mayClose === false) {
              closing = false
              return
            }
            await appWindow.destroy()
          } catch (error) {
            // A failed destroy() (e.g. a missing ACL grant) must not leave
            // the window permanently unclosable — let the next attempt
            // through instead of silently eating every close request.
            closing = false
            console.error("useTauriCloseGuard: failed to close after settling", error)
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
