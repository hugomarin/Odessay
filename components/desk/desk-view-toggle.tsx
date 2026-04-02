"use client"

import { cn } from "@/lib/utils"

export type DeskViewMode = "mine" | "shared"

type DeskViewToggleProps = {
  activeView: DeskViewMode
  onViewChange: (nextView: DeskViewMode) => void
}

const VIEW_TABS: Array<{ value: DeskViewMode; label: string }> = [
  { value: "mine", label: "My writings" },
  { value: "shared", label: "Shared with me" },
]

export function DeskViewToggle({ activeView, onViewChange }: DeskViewToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {VIEW_TABS.map((tab) => {
        const isActive = activeView === tab.value

        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={isActive}
            data-testid={`desk-view-tab-${tab.value}`}
            onClick={() => onViewChange(tab.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              isActive ? "bg-bg text-ink shadow-sm" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
