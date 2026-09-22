"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useResizablePanel } from "@/hooks/useResizablePanel"

/**
 * Right panel chrome — width, drag-resize, and the resize handle live here
 * (own feature pass, same pattern as EditorNavigationSidebar's left panel),
 * scoped to this component so a drag only re-renders this subtree instead of
 * the whole EditorShell. Content (tabs strip + active panel body) is passed
 * as children.
 */

const RIGHT_PANEL_WIDTH_STORAGE_KEY = "od:editor-right-panel-width"
const DEFAULT_RIGHT_PANEL_WIDTH = 276
const MIN_RIGHT_PANEL_WIDTH = 240
const MAX_RIGHT_PANEL_WIDTH = 480

export function clampRightPanelWidth(width: number): number {
  return Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, width))
}

export function EditorRightPanel({ children }: { children: ReactNode }) {
  const { width, isResizing, handlePointerDown, reset } = useResizablePanel({
    storageKey: RIGHT_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: DEFAULT_RIGHT_PANEL_WIDTH,
    minWidth: MIN_RIGHT_PANEL_WIDTH,
    maxWidth: MAX_RIGHT_PANEL_WIDTH,
    // Dragging the panel's left edge left grows it, so the delta is inverted
    // relative to the left nav panel's drag (which grows to the right).
    invert: true,
  })

  return (
    <aside
      data-testid="editor-right-panel"
      // The panel is always a column of the band. It used to float over the
      // sheet below 1440 — the desktop window opens at 1280, so that was its
      // normal state and it covered the text (owner decision, ODE-433
      // follow-up).
      style={{ width }}
      className={cn(
        "EditorRightPanel relative flex shrink-0 flex-col overflow-hidden font-sans",
        !isResizing && "transition-[width] duration-[300ms] ease-layout",
      )}
    >
      {children}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        aria-valuenow={width}
        aria-valuemin={MIN_RIGHT_PANEL_WIDTH}
        aria-valuemax={MAX_RIGHT_PANEL_WIDTH}
        onPointerDown={handlePointerDown}
        onDoubleClick={reset}
        className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none select-none"
      >
        <div
          className={cn(
            "mx-auto h-full w-px bg-transparent transition-colors",
            isResizing ? "bg-cursor" : "hover:bg-border",
          )}
        />
      </div>
    </aside>
  )
}
