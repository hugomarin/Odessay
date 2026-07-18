"use client"

import { useEffect, useRef } from "react"
import type { FloatingOverlayAnchor } from "@/lib/reading/floating-overlay-position"
import { useFloatingOverlayPosition } from "./use-floating-overlay-position"

export type SelectionPopupPosition = FloatingOverlayAnchor & { y: number }

type SelectionPopupProps = {
  position: SelectionPopupPosition | null
  onSelectType?: (type: "personal" | "ai" | "footnote") => void
  onMark?: () => void
  onAnnotate?: () => void
  onFootnote?: () => void
  onDismiss: () => void
}

export function SelectionPopup({ position, onSelectType, onMark, onAnnotate, onFootnote, onDismiss }: SelectionPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const floatingPosition = useFloatingOverlayPosition({
    anchor: position,
    overlayRef: ref,
    preferredPlacement: "above",
  })

  // Dismiss on click outside
  useEffect(() => {
    if (!position) return

    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [position, onDismiss])

  if (!position) return null

  return (
    <div
      ref={ref}
      id="selection-popup"
      data-section="selection-popup"
      data-testid="selection-popup"
      data-placement={floatingPosition?.placement ?? "above"}
      className="SelectionPopup"
      style={{
        position: "fixed",
        left: floatingPosition?.left ?? position.x,
        top: floatingPosition?.top ?? position.y,
        visibility: floatingPosition ? "visible" : "hidden",
        zIndex: 50,
        animation: "selectionPopupIn 150ms ease forwards",
      }}
    >
      <div
        className="flex items-center rounded-[10px] bg-ink px-0.5 py-0.5"
      >
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onSelectType) onSelectType("personal")
            else onMark?.()
          }}
          className="rounded-[8px] px-3 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
          aria-label="Mark passage"
        >
          Highlight
        </button>
        <span className="h-4 w-px bg-bg/25" />
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onSelectType) onSelectType("ai")
            else onAnnotate?.()
          }}
          className="rounded-[8px] px-3 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
          aria-label="Annotate passage"
        >
          AI
        </button>
        <span className="h-4 w-px bg-bg/25" />
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onSelectType) onSelectType("footnote")
            else onFootnote?.()
          }}
          className="rounded-[8px] px-3 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
          aria-label="Add footnote"
        >
          Footnote
        </button>
      </div>

      <style>{`
        @keyframes selectionPopupIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
