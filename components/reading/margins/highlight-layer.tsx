"use client"

import { useEffect, useRef } from "react"

export type MarginHighlight = {
  id: string
  anchor_start: number
  anchor_end: number
  note: string | null
  type: "personal" | "ai"
}

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

  if (node) {
    const text = node as Text
    return { node: text, offset: text.length }
  }

  return null
}

function collectTextNodes(root: Element): Array<{ node: Text; start: number; end: number }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number; end: number }> = []
  let charCount = 0
  let node: Node | null

  while ((node = walker.nextNode())) {
    const text = node as Text
    const start = charCount
    const end = start + text.length
    nodes.push({ node: text, start, end })
    charCount = end
  }

  return nodes
}

function decorateExistingMark(mark: HTMLElement, margin: MarginHighlight) {
  mark.classList.add("hl")
  mark.classList.add(margin.type === "ai" ? "hl-ai" : "hl-personal")
  if (margin.note) {
    mark.classList.add("annotated")
  } else {
    mark.classList.remove("annotated")
  }
  mark.dataset.id = margin.id
}

function maybeDecorateExistingMark(root: Element, node: Text, margin: MarginHighlight): boolean {
  const mark = node.parentElement?.closest("mark")
  if (!mark || !root.contains(mark)) {
    return false
  }

  decorateExistingMark(mark, margin)
  return true
}

export function applyHighlight(root: Element, margin: MarginHighlight): boolean {
  const startPos = findTextPosition(root, margin.anchor_start)
  const endPos = findTextPosition(root, margin.anchor_end)
  if (!startPos || !endPos) return false

  const nodes = collectTextNodes(root)
  const typeClass = margin.type === "ai" ? "hl-ai" : "hl-personal"
  const wrapperClass = `hl ${typeClass}${margin.note ? " annotated" : ""}`
  let wrapped = false

  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const { node, start, end } = nodes[i]
    const overlapStart = Math.max(start, margin.anchor_start)
    const overlapEnd = Math.min(end, margin.anchor_end)
    if (overlapStart >= overlapEnd) continue

    const localStart = overlapStart - start
    const localEnd = overlapEnd - start

    try {
      if (maybeDecorateExistingMark(root, node, margin)) {
        wrapped = true
        continue
      }

      const range = document.createRange()
      range.setStart(node, localStart)
      range.setEnd(node, localEnd)

      const wrapper = document.createElement("span")
      wrapper.className = wrapperClass
      wrapper.dataset.id = margin.id

      range.surroundContents(wrapper)
      wrapped = true
    } catch {
      // Ignore fragments that cannot be wrapped cleanly.
    }
  }

  return wrapped
}

export function HighlightLayer({ bodyRef, margins, onHighlightClick }: HighlightLayerProps) {
  const originalHtmlRef = useRef<string | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const root = body

    if (originalHtmlRef.current === null) {
      originalHtmlRef.current = body.innerHTML
    }

    const originalHtml = originalHtmlRef.current
    if (!originalHtml) return

    root.innerHTML = originalHtml

    const sortedMargins = [...margins].sort((a, b) => {
      if (a.anchor_start !== b.anchor_start) return b.anchor_start - a.anchor_start
      return b.anchor_end - a.anchor_end
    })

    for (const margin of sortedMargins) {
      applyHighlight(root, margin)
    }

    function handleClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return

      const highlight = target.closest(".hl[data-id]")
      if (!highlight) return
      if (!root.contains(highlight)) return

      const marginId = highlight.getAttribute("data-id")
      if (marginId) onHighlightClick(marginId)
    }

    root.addEventListener("click", handleClick)
    return () => {
      root.removeEventListener("click", handleClick)
    }
  }, [bodyRef, margins, onHighlightClick])

  return null
}
