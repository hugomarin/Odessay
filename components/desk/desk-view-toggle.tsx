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
    <div className="inline-flex h-11 items-center gap-1 rounded-[12px] bg-muted/70 p-1">
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
              "inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-[13px] font-medium transition-colors",
              isActive ? "bg-bg text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {tab.label}
            {typeof count === "number" ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(220,44%,93%)] px-1.5 text-[10px] font-bold text-[hsl(220,50%,40%)]">
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
