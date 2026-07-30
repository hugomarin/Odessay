export type FloatingOverlayPlacement = "above" | "below"

export type FloatingOverlayAnchor = {
  x: number
  top: number
  bottom: number
}

type FloatingOverlaySize = {
  width: number
  height: number
}

type FloatingOverlayViewport = {
  width: number
  height: number
}

type CalculateFloatingOverlayPositionOptions = {
  anchor: FloatingOverlayAnchor
  overlay: FloatingOverlaySize
  viewport: FloatingOverlayViewport
  preferredPlacement: FloatingOverlayPlacement
  gap?: number
  margin?: number
  topBoundary?: number
}

export type FloatingOverlayPosition = {
  left: number
  top: number
  maxHeight: number
  placement: FloatingOverlayPlacement
}

const DEFAULT_GAP = 8
const DEFAULT_MARGIN = 8
const DEFAULT_TOP_BOUNDARY = 54

/**
 * Geometry equality (ODE-409).
 *
 * Scroll/resize handlers recompute anchors continuously. Emitting a fresh
 * anchor object when nothing actually moved re-renders every overlay consumer
 * and — before ODE-409 — re-ran effects keyed on the anchor identity, which is
 * what wiped an in-progress annotation draft. Owners use these comparators to
 * keep the previous object when the geometry is unchanged.
 */
export function areFloatingOverlayAnchorsEqual(
  a: (FloatingOverlayAnchor & { y?: number }) | null | undefined,
  b: (FloatingOverlayAnchor & { y?: number }) | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.top === b.top && a.bottom === b.bottom && a.y === b.y
}

export function areFloatingOverlayPositionsEqual(
  a: FloatingOverlayPosition | null | undefined,
  b: FloatingOverlayPosition | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.maxHeight === b.maxHeight &&
    a.placement === b.placement
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function calculateFloatingOverlayPosition({
  anchor,
  overlay,
  viewport,
  preferredPlacement,
  gap = DEFAULT_GAP,
  margin = DEFAULT_MARGIN,
  topBoundary = DEFAULT_TOP_BOUNDARY,
}: CalculateFloatingOverlayPositionOptions): FloatingOverlayPosition {
  const viewportBottom = Math.max(topBoundary, viewport.height - margin)
  const maxHeight = Math.max(0, viewportBottom - topBoundary)
  const effectiveHeight = Math.min(overlay.height, maxHeight)
  const spaceAbove = anchor.top - gap - topBoundary
  const spaceBelow = viewportBottom - anchor.bottom - gap

  let placement = preferredPlacement
  const preferredSpace = preferredPlacement === "above" ? spaceAbove : spaceBelow
  const oppositeSpace = preferredPlacement === "above" ? spaceBelow : spaceAbove

  if (effectiveHeight > preferredSpace && oppositeSpace > preferredSpace) {
    placement = preferredPlacement === "above" ? "below" : "above"
  }

  const desiredTop =
    placement === "above"
      ? anchor.top - gap - effectiveHeight
      : anchor.bottom + gap
  const top = clamp(desiredTop, topBoundary, viewportBottom - effectiveHeight)

  const maxLeft = viewport.width - margin - overlay.width
  const left = clamp(anchor.x - overlay.width / 2, margin, maxLeft)

  return {
    left,
    top,
    maxHeight,
    placement,
  }
}
