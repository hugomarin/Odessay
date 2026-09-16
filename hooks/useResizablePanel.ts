"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Drag-to-resize width for a panel: pointer-drag, clamped to [minWidth,
 * maxWidth], persisted to localStorage, reset on double-click. Shared by
 * every panel that resizes this way (right panel today; the left nav panel
 * and the app rail predate this hook and keep their own copies).
 */
export type UseResizablePanelOptions = {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  /** true when dragging the handle left (not right) grows the panel — a panel resized from its left edge. Defaults to false. */
  invert?: boolean
}

export function useResizablePanel({ storageKey, defaultWidth, minWidth, maxWidth, invert = false }: UseResizablePanelOptions) {
  const clamp = useCallback((value: number) => Math.min(maxWidth, Math.max(minWidth, value)), [minWidth, maxWidth])

  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(storageKey))
    if (Number.isFinite(stored) && stored > 0) setWidth(clamp(stored))
    // Only meant to run once, on mount, against this hook instance's own key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = event.clientX - drag.startX
      setWidth(clamp(drag.startWidth + (invert ? -delta : delta)))
    },
    [clamp, invert],
  )

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
    setIsResizing(false)
    document.body.style.removeProperty("user-select")
    window.removeEventListener("pointermove", handlePointerMove)
    window.removeEventListener("pointerup", handlePointerUp)
    setWidth((current) => {
      window.localStorage.setItem(storageKey, String(current))
      return current
    })
  }, [handlePointerMove, storageKey])

  // Belt-and-suspenders unmount cleanup — a drag that ends by the panel
  // closing (Escape, clicking away) still needs these off the window.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }
  }, [handlePointerMove, handlePointerUp])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      dragRef.current = { startX: event.clientX, startWidth: width }
      setIsResizing(true)
      document.body.style.userSelect = "none"
      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
    },
    [width, handlePointerMove, handlePointerUp],
  )

  const reset = useCallback(() => {
    setWidth(defaultWidth)
    window.localStorage.setItem(storageKey, String(defaultWidth))
  }, [defaultWidth, storageKey])

  return { width, isResizing, handlePointerDown, reset }
}
