"use client"

import { cn } from "@/lib/utils"

export type DeskViewMode = "mine" | "shared"

type DeskViewToggleProps = {
  activeView: DeskViewMode
  counts?: Record<DeskViewMode, number>
  onViewChange: (nextView: DeskViewMode) => void
}

const VIEW_TABS: Array<{ value: DeskViewMode; label: string }> = [
  { value: "mine", label: "My writings" },
  { value: "shared", label: "Shared with me" },
]

export function DeskViewToggle({ activeView, counts, onViewChange }: DeskViewToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[14px] bg-muted/70 p-1">
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
              "inline-flex items-center gap-[10px] rounded-[11px] px-4 py-[9px] text-[14px] font-medium transition-colors",
              isActive ? "bg-bg text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {tab.label}
            {typeof count === "number" ? (
              <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[hsl(220,44%,93%)] px-[7px] text-[11px] font-bold text-[hsl(220,50%,40%)]">
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
