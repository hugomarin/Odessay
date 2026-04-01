"use client"

import { useEffect, useRef, useState } from "react"

export type MarginHighlight = {
  id: string
  anchor_start: number
  anchor_end: number
  note: string | null
}

type Rect = { top: number; left: number; width: number; height: number; key: string }

type HighlightLayerProps = {
  bodyRef: React.RefObject<HTMLDivElement | null>
  margins: MarginHighlight[]
  onHighlightClick: (marginId: string) => void
}

/**
 * Maps a plain-text character offset to a {node, offset} position within a DOM subtree.
 * Walks all Text nodes in document order, counting characters.
 */
function findTextPosition(
  root: Element,
  targetOffset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let charCount = 0
  let node: Node | null

  while ((node = walker.nextNode())) {
    const text = node as Text
    const len = text.length
    if (charCount + len >= targetOffset) {
      return { node: text, offset: targetOffset - charCount }
    }
    charCount += len
  }

  // Clamp to end of last text node
  if (node) {
    const text = node as Text
    return { node: text, offset: text.length }
  }

  return null
}

/**
 * Returns bounding client rects for a plain-text range [start, end) in a DOM element.
 */
function getRangeRects(root: Element, start: number, end: number): DOMRect[] {
  const startPos = findTextPosition(root, start)
  const endPos = findTextPosition(root, end)
  if (!startPos || !endPos) return []

  try {
    const range = document.createRange()
    range.setStart(startPos.node, startPos.offset)
    range.setEnd(endPos.node, endPos.offset)
    return Array.from(range.getClientRects())
  } catch {
    return []
  }
}

export function HighlightLayer({ bodyRef, margins, onHighlightClick }: HighlightLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [highlightRects, setHighlightRects] = useState<
    { marginId: string; hasNote: boolean; rects: Rect[] }[]
  >([])

  function recalculate() {
    const body = bodyRef.current
    const container = containerRef.current
    if (!body || !container) return

    const containerRect = container.getBoundingClientRect()

    const next = margins.map((margin) => {
      const clientRects = getRangeRects(body, margin.anchor_start, margin.anchor_end)
      const rects: Rect[] = clientRects
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r, i) => ({
          top: r.top - containerRect.top,
          left: r.left - containerRect.left,
          width: r.width,
          height: r.height,
          key: `${margin.id}-${i}`,
        }))
      return { marginId: margin.id, hasNote: !!margin.note, rects }
    })

    setHighlightRects(next)
  }

  // Recalculate on mount and on every margins change
  useEffect(() => {
    recalculate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margins, bodyRef.current])

  // Recalculate on resize via ResizeObserver
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return

    const observer = new ResizeObserver(() => {
      recalculate()
    })
    observer.observe(body)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyRef.current, margins])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {highlightRects.map(({ marginId, hasNote, rects }) =>
        rects.map((rect) => (
          <button
            key={rect.key}
            data-margin-id={marginId}
            onClick={() => onHighlightClick(marginId)}
            aria-label="Open margin"
            style={{
              position: "absolute",
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              background: "hsl(45,90%,84%)",
              opacity: 0.7,
              borderRadius: 2,
              border: "none",
              cursor: "pointer",
              pointerEvents: "auto",
              borderBottom: hasNote ? "1.5px solid hsl(35,80%,55%)" : undefined,
              // Hover handled via CSS class
            }}
            className="highlight-rect"
          />
        )),
      )}
      <style>{`
        .highlight-rect:hover { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
