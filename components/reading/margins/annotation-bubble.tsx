"use client"

import { useEffect, useRef, useState } from "react"

type AnnotationBubbleProps = {
  position: { x: number; y: number } | null
  type?: "personal" | "ai" | "collaborative" | "footnote"
  onConfirm: (note: string) => void
  onCancel: () => void
}

const AI_QUICK_CHIPS = ["eliminar", "modificar", "expandir", "valida esto", "simplifica", "mantén tono"]

export function AnnotationBubble({ position, type = "personal", onConfirm, onCancel }: AnnotationBubbleProps) {
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
      className="AnnotationBubble rounded-[12px] border-[0.5px] border-border bg-sb shadow-float-lg"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        transform: "translateX(-50%)",
        width: 260,
        zIndex: 50,
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
        placeholder={type === "footnote" ? "Write your footnote…" : type === "ai" ? "Write your AI instruction…" : "Write your annotation…"}
        rows={3}
        className="w-full resize-none rounded-[6px] bg-transparent font-sans text-[13px] text-ink-2 placeholder:text-ink-4 focus:outline-none"
        style={{ border: "none" }}
        aria-label="Annotation text"
      />
      {type === "ai" ? (
        <div className="flex flex-wrap gap-1">
          {AI_QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => setNote((current) => (current ? `${current} ${chip}` : chip))}
              className="rounded-full bg-muted px-2 py-1 font-sans text-[11px] text-ink-3 transition-colors hover:bg-muted-hover"
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
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
          {type === "footnote" ? "Add footnote" : "Save"}
        </button>
      </div>
    </div>
  )
}
