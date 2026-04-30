"use client"

import { useEffect, useRef } from "react"

type SelectionPopupProps = {
  position: { x: number; y: number } | null
  onMark: () => void
  onAnnotate: () => void
  onFootnote?: () => void
  onDismiss: () => void
}

export function SelectionPopup({ position, onMark, onAnnotate, onFootnote, onDismiss }: SelectionPopupProps) {
  const ref = useRef<HTMLDivElement>(null)

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
      className="SelectionPopup"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -100%)",
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
            onMark()
          }}
          className="rounded-[8px] px-3 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
          aria-label="Mark passage"
        >
          Mark
        </button>
        <span className="h-4 w-px bg-bg/25" />
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onAnnotate()
          }}
          className="rounded-[8px] px-3 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
          aria-label="Annotate passage"
        >
          Annotate
        </button>
        {onFootnote ? (
          <>
            <span className="h-4 w-px bg-bg/25" />
            <button
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onFootnote()
              }}
              className="rounded-[8px] px-3 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
              aria-label="Add footnote"
            >
              Footnote
            </button>
          </>
        ) : null}
      </div>

      <style>{`
        @keyframes selectionPopupIn {
          from { opacity: 0; transform: translate(-50%, calc(-100% + 4px)); }
          to   { opacity: 1; transform: translate(-50%, -100%); }
        }
      `}</style>
    </div>
  )
}
