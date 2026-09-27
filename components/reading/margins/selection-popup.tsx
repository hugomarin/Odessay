"use client"

import { useEffect, useRef, useState } from "react"
import type { FloatingOverlayAnchor } from "@/lib/reading/floating-overlay-position"
import { useFloatingOverlayPosition } from "./use-floating-overlay-position"
import {
  DEFAULT_HIGHLIGHT_COLOR,
  ENTITY_TYPES,
  HIGHLIGHT_COLORS,
  type EntityTypeName,
  type HighlightColorName,
} from "@/lib/editor/semantic-marks"

export type SelectionPopupPosition = FloatingOverlayAnchor & { y: number }

export type SemanticMarkApplyResult = string | null

type SelectionPopupProps = {
  position: SelectionPopupPosition | null
  onSelectType?: (type: "personal" | "ai" | "footnote") => void
  onMark?: () => void
  onAnnotate?: () => void
  onFootnote?: () => void
  onDismiss: () => void
  /** Authoring affordances for the controlled semantic marks. Omitted on reading surfaces. */
  onApplyEntity?: (type: EntityTypeName) => SemanticMarkApplyResult
  onApplyHighlight?: (color: HighlightColorName) => SemanticMarkApplyResult
}

type PopupView = "main" | "menu" | "entity" | "highlight"

const ENTITY_TYPE_LABEL: Record<EntityTypeName, string> = {
  person: "Person",
  company: "Company",
  organization: "Organization",
  place: "Place",
  event: "Event",
  product: "Product",
  other: "Other",
}

const HIGHLIGHT_COLOR_LABEL: Record<HighlightColorName, string> = {
  amber: "Amber",
  green: "Green",
  indigo: "Indigo",
  slate: "Slate",
}

const HIGHLIGHT_SWATCH_COLOR: Record<HighlightColorName, string> = {
  amber: "#C07B2A",
  green: "#2E7D4F",
  indigo: "#5B5BD6",
  slate: "#999990",
}

export function SelectionPopup({
  position,
  onSelectType,
  onMark,
  onAnnotate,
  onFootnote,
  onDismiss,
  onApplyEntity,
  onApplyHighlight,
}: SelectionPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<PopupView>("main")
  const [failure, setFailure] = useState<SemanticMarkApplyResult>(null)
  const floatingPosition = useFloatingOverlayPosition({
    anchor: position,
    overlayRef: ref,
    preferredPlacement: "above",
  })

  const hasSemanticActions = Boolean(onApplyEntity && onApplyHighlight)
  const pendingTriggerFocusRef = useRef(false)

  // A new selection restarts at the main view.
  useEffect(() => {
    setView("main")
    setFailure(null)
  }, [position])

  // Dismiss on click outside
  useEffect(() => {
    if (!position) return

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      // A detached target means React already consumed this interaction inside
      // the popup: discrete-event updates flush synchronously, so a view
      // switch (More → menu → options) unmounts the clicked button before the
      // native event reaches this document-level bubble listener. Treating it
      // as an outside click would dismiss the popup on every in-popup
      // navigation whose success path keeps the popup open.
      if (!target || !document.contains(target)) return
      if (ref.current && !ref.current.contains(target)) {
        onDismiss()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [position, onDismiss])

  // Move focus into the active view so keyboard users land on the first option;
  // when the main row remounts, focus returns to the More trigger.
  useEffect(() => {
    if (!position) return
    if (view === "main") {
      if (pendingTriggerFocusRef.current) {
        pendingTriggerFocusRef.current = false
        moreTriggerRef.current?.focus()
      }
      return
    }
    pendingTriggerFocusRef.current = false
    const firstButton = ref.current?.querySelector<HTMLButtonElement>("[data-popup-view] button")
    firstButton?.focus()
  }, [view, position])

  const applyEntity = (type: EntityTypeName) => {
    const result = onApplyEntity?.(type) ?? null
    if (result) {
      setFailure(result)
      return
    }
    onDismiss()
  }

  const applyHighlight = (color: HighlightColorName) => {
    const result = onApplyHighlight?.(color) ?? null
    if (result) {
      setFailure(result)
      return
    }
    onDismiss()
  }

  const returnToMain = () => {
    pendingTriggerFocusRef.current = true
    setFailure(null)
    setView("main")
  }

  const handleEscape = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    if (view === "entity" || view === "highlight") {
      setFailure(null)
      setView("menu")
      return
    }
    if (view === "menu") {
      pendingTriggerFocusRef.current = true
      setFailure(null)
      setView("main")
      return
    }
    onDismiss()
  }

  if (!position) return null

  const renderMainRow = () => (
    <div className="flex items-center rounded-[10px] bg-ink px-0.5 py-0.5">
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
      {hasSemanticActions ? (
        <>
          <span className="h-4 w-px bg-bg/25" />
          <button
            ref={moreTriggerRef}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setFailure(null)
              setView((current) => (current === "menu" ? "main" : "menu"))
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && view === "main") {
                e.preventDefault()
                setView("menu")
              }
            }}
            className="rounded-[8px] px-2.5 py-1.5 font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"
            aria-label="More mark options"
            aria-expanded={view === "menu"}
            aria-haspopup="menu"
          >
            More
          </button>
        </>
      ) : null}
    </div>
  )

  const menuItemClass =
    "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left font-sans text-[12px] font-medium text-bg transition-colors hover:bg-white/10"

  const renderSemanticView = () => (
    <div
      data-popup-view=""
      className="flex min-w-[200px] flex-col rounded-[10px] bg-ink p-1.5"
      role="menu"
      aria-label={view === "entity" ? "Entity type" : "Highlight color"}
      onKeyDown={handleEscape}
    >
      <div className="px-2 pb-1 pt-0.5 font-sans text-[11px] font-medium uppercase tracking-[0.04em] text-bg/60">
        {view === "entity" ? "Entity type" : "Highlight color"}
      </div>
      {view === "entity"
        ? ENTITY_TYPES.map((type) => (
            <button
              key={type}
              role="menuitem"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                applyEntity(type)
              }}
              className={`${menuItemClass} text-bg transition-colors hover:bg-white/10`}
            >
              {ENTITY_TYPE_LABEL[type]}
            </button>
          ))
        : HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              role="menuitem"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                applyHighlight(color)
              }}
              className={`${menuItemClass} text-bg transition-colors hover:bg-white/10`}
              aria-label={`Highlight ${HIGHLIGHT_COLOR_LABEL[color]}${color === DEFAULT_HIGHLIGHT_COLOR ? " (default)" : ""}`}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: HIGHLIGHT_SWATCH_COLOR[color] }}
              />
              {HIGHLIGHT_COLOR_LABEL[color]}
            </button>
          ))}
      {failure ? (
        <p role="status" aria-live="polite" className="px-2 pb-1 pt-1.5 font-sans text-[11px] leading-snug text-[#E8A020]">
          {failure}
        </p>
      ) : null}
    </div>
  )

  const renderMenuView = () => (
    <div
      data-popup-view=""
      className="flex min-w-[200px] flex-col rounded-[10px] bg-ink p-1.5"
      role="menu"
      aria-label="Semantic marks"
      onKeyDown={handleEscape}
    >
      <button
        role="menuitem"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setView("entity")
        }}
        className={`${menuItemClass} text-bg transition-colors hover:bg-white/10`}
      >
        Entity
      </button>
      <button
        role="menuitem"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setView("highlight")
        }}
        className={`${menuItemClass} text-bg transition-colors hover:bg-white/10`}
      >
        Highlight
      </button>
      <span className="mx-1 my-0.5 h-px bg-bg/25" />
      <button
        role="menuitem"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          returnToMain()
        }}
        className={`${menuItemClass} text-bg/70 transition-colors hover:bg-white/10`}
      >
        Back
      </button>
      {failure ? (
        <p role="status" aria-live="polite" className="px-2 pb-1 pt-1.5 font-sans text-[11px] leading-snug text-[#E8A020]">
          {failure}
        </p>
      ) : null}
    </div>
  )

  return (
    <div
      ref={ref}
      id="selection-popup"
      data-section="selection-popup"
      data-testid="selection-popup"
      data-placement={floatingPosition?.placement ?? "above"}
      className="SelectionPopup"
      onKeyDown={view === "main" ? handleEscape : undefined}
      style={{
        position: "fixed",
        left: floatingPosition?.left ?? position.x,
        top: floatingPosition?.top ?? position.y,
        visibility: floatingPosition ? "visible" : "hidden",
        zIndex: 50,
        animation: "selectionPopupIn 150ms ease forwards",
      }}
    >
      {view === "entity" || view === "highlight"
        ? renderSemanticView()
        : view === "menu"
          ? renderMenuView()
          : renderMainRow()}

      <style>{`
        @keyframes selectionPopupIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
