"use client"

import { cn } from "@/lib/utils"

export type DeskViewMode = "mine" | "shared"

type DeskViewToggleProps = {
  activeView: DeskViewMode
  counts?: Record<DeskViewMode, number>
  onViewChange: (nextView: DeskViewMode) => void
}

/**
 * Scope tabs — "My artifacts" / "Shared with me", the first control in the
 * Desk's toolbar row.
 *
 * Prototype values: a `--surface-menu-hover` track at radius 10 with 4px of
 * padding and a 2px gap; tabs 32px tall at radius 8 with 14px of side padding;
 * the active tab on the sheet colour with a 1px lift; counts in a 20px pill.
 */
const VIEW_TABS: Array<{ value: DeskViewMode; label: string }> = [
  { value: "mine", label: "My artifacts" },
  { value: "shared", label: "Shared with me" },
]

export function DeskViewToggle({ activeView, counts, onViewChange }: DeskViewToggleProps) {
  return (
    <div className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-[10px] bg-surface-menu-hover p-1">
      {VIEW_TABS.map((tab) => {
        const isActive = activeView === tab.value
        const count = counts?.[tab.value]

        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={isActive}
            data-testid={`desk-view-tab-${tab.value}`}
            onClick={() => onViewChange(tab.value)}
            className={cn(
              "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[8px] px-[14px] text-[14px] transition-colors",
              isActive ? "bg-sb font-medium text-ink shadow-float" : "font-normal text-ink-4",
            )}
          >
            {tab.label}
            {typeof count === "number" ? (
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] px-1.5 text-[11px] font-medium",
                  isActive ? "bg-line-soft text-ink-2" : "bg-muted-hover text-ink-4",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
