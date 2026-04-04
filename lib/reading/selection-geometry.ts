export type SelectionViewportRect = {
  top: number
  left: number
  width: number
  height: number
}

export type SelectionPreviewRect = {
  top: number
  left: number
  width: number
  height: number
  key: string
}

export type SelectionGeometry = {
  popupPosition: { x: number; y: number }
  bubblePosition: { x: number; y: number }
  previewRects: SelectionPreviewRect[]
}

type BuildSelectionGeometryParams = {
  rects: SelectionViewportRect[]
  bodyRect: Pick<DOMRectReadOnly, "top" | "left">
  anchorStart: number
  anchorEnd: number
}

/**
 * Builds a single geometry contract for selection UI in reading mode:
 * - popup + bubble positions in viewport coordinates (position: fixed)
 * - preview rects in body-local coordinates (absolute overlay inside body wrapper)
 */
export function buildSelectionGeometry({
  rects,
  bodyRect,
  anchorStart,
  anchorEnd,
}: BuildSelectionGeometryParams): SelectionGeometry | null {
  const visibleRects = rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (visibleRects.length === 0) return null

  const [firstRect] = visibleRects
  if (!firstRect) return null

  const previewRects = visibleRects.map((rect, index) => ({
    top: rect.top - bodyRect.top,
    left: rect.left - bodyRect.left,
    width: rect.width,
    height: rect.height,
    key: `${anchorStart}-${anchorEnd}-${index}`,
  }))

  const popupPosition = {
    x: firstRect.left + firstRect.width / 2,
    y: firstRect.top - 8,
  }

  const maxBottom = Math.max(...visibleRects.map((rect) => rect.top + rect.height))
  const bubblePosition = {
    x: popupPosition.x,
    y: maxBottom + 8,
  }

  return {
    popupPosition,
    bubblePosition,
    previewRects,
  }
}
