import type { DeskActivityFilter } from "@/lib/queries/desk-activity"
import { cn } from "@/lib/utils"

type DeskFilterBarProps = {
  activeFilter: DeskActivityFilter
  counts: Record<DeskActivityFilter, number>
  onFilterChange: (nextFilter: DeskActivityFilter) => void
}

const FILTERS: Array<{ id: DeskActivityFilter; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "correspondence", label: "Correspondence" },
  { id: "with-responses", label: "With responses" },
  { id: "received", label: "Received" },
]

export function DeskFilterBar({ activeFilter, counts, onFilterChange }: DeskFilterBarProps) {
  return (
    <div
      id="desk-filter-bar"
      data-section="desk-filter-bar"
      data-testid="desk-filter-bar"
      className="DeskFilterBar flex h-[46px] items-center justify-between gap-2 border-b-[0.5px] border-border px-9"
    >
      <div className="flex items-center gap-1">
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.id
          return (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-[7px] px-3 text-[12px] font-medium transition-colors",
                isActive
                  ? "bg-ink text-bg"
                  : "bg-transparent text-ink-4 hover:bg-muted hover:text-ink-2",
              )}
            >
              {filter.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-[1px] text-[10px] font-semibold",
                  isActive
                    ? "bg-bg/15 text-bg"
                    : "bg-[hsl(220,40%,92%)] text-[hsl(220,50%,40%)]",
                )}
              >
                {counts[filter.id]}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-[12px] text-ink-4">{counts[activeFilter]} items</p>
    </div>
  )
}
