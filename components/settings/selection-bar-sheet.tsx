"use client"

import { SELECTION_BAR_SHEET_ATTR } from "@/components/shared/selection-bar"

/**
 * The scrolling sheet a Settings section renders into.
 *
 * Marking it explicitly is what lets the shared selection bar pad the last row
 * out from under itself in Archived artifacts, instead of falling back to
 * guessing the nearest scrollable ancestor.
 */
export function SelectionBarSheet({ children }: { children: React.ReactNode }) {
  return (
    <div
      {...{ [SELECTION_BAR_SHEET_ATTR]: "" }}
      className="od-scroll min-h-0 flex-1 overflow-y-auto"
    >
      {children}
    </div>
  )
}
