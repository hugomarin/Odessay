"use client"

import { useLayoutEffect, useState, type RefObject } from "react"
import {
  areFloatingOverlayPositionsEqual,
  calculateFloatingOverlayPosition,
  type FloatingOverlayAnchor,
  type FloatingOverlayPlacement,
  type FloatingOverlayPosition,
} from "@/lib/reading/floating-overlay-position"

type UseFloatingOverlayPositionOptions = {
  anchor: FloatingOverlayAnchor | null
  overlayRef: RefObject<HTMLElement | null>
  preferredPlacement: FloatingOverlayPlacement
}

export function useFloatingOverlayPosition({
  anchor,
  overlayRef,
  preferredPlacement,
}: UseFloatingOverlayPositionOptions): FloatingOverlayPosition | null {
  const [position, setPosition] = useState<FloatingOverlayPosition | null>(null)

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (!anchor || !overlay) {
      setPosition(null)
      return
    }

    let frameId: number | null = null

    const measure = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const rect = overlay.getBoundingClientRect()
        const next = calculateFloatingOverlayPosition({
          anchor,
          overlay: { width: rect.width, height: rect.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          preferredPlacement,
        })
        // ODE-409: only publish a new object when the geometry actually moved.
        // A ResizeObserver fires for content growth (typing, waveform, error
        // text); re-rendering consumers on every one of those is churn.
        setPosition((current) => (areFloatingOverlayPositionsEqual(current, next) ? current : next))
      })
    }

    measure()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    resizeObserver?.observe(overlay)
    window.addEventListener("resize", measure)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      resizeObserver?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [anchor, overlayRef, preferredPlacement])

  return position
}
