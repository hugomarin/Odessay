"use client"

import { useEffect, useRef, useState } from "react"

type AnnotationBubbleProps = {
  position: { x: number; y: number } | null
  onConfirm: (note: string) => void
  onCancel: () => void
}

export function AnnotationBubble({ position, onConfirm, onCancel }: AnnotationBubbleProps) {
  const [note, setNote] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Focus textarea when shown
  useEffect(() => {
    if (position) {
      setNote("")
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [position])

  // Dismiss on Escape, confirm on Enter (without shift)
  useEffect(() => {
    if (!position) return

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel()
      }
    }

    document.addEventListener("keydown", handleKeydown)
    return () => document.removeEventListener("keydown", handleKeydown)
  }, [position, onCancel])

  if (!position) return null

  function handleConfirm() {
    const trimmed = note.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <div
      ref={containerRef}
      id="annotation-bubble"
      data-section="annotation-bubble"
      data-testid="annotation-bubble"
      className="AnnotationBubble"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y + 8,
        transform: "translateX(-50%)",
        width: 260,
        zIndex: 50,
        background: "var(--sb)",
        border: "0.5px solid var(--border)",
        borderRadius: 12,
        boxShadow: "var(--shadow-float-lg, 0 8px 32px rgba(0,0,0,0.12))",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleConfirm()
          }
        }}
        placeholder="Write your annotation…"
        rows={3}
        className="w-full resize-none rounded-[6px] bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 focus:outline-none"
        style={{ border: "none" }}
        aria-label="Annotation text"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-[7px] px-3 py-1 font-sans text-[12px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!note.trim()}
          className="rounded-[7px] bg-ink px-3 py-1 font-sans text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Annotate
        </button>
      </div>
    </div>
  )
}
