"use client"

import { Check } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { DeskGroupBy } from "@/lib/queries/desk-activity"
import { cn } from "@/lib/utils"

type GroupByControlProps = {
  value: DeskGroupBy
  onChange: (value: DeskGroupBy) => void
}

const OPTIONS: { value: DeskGroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "status", label: "Status" },
  { value: "collection", label: "Collection" },
  { value: "created-date", label: "Created date" },
]

export function GroupByControl({ value, onChange }: GroupByControlProps) {
  const activeLabel = OPTIONS.find((option) => option.value === value)?.label ?? "Group by"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[13px] font-medium transition-colors",
            value !== "none"
              ? "bg-ink text-bg hover:opacity-90"
              : "bg-muted/70 text-ink-2 hover:bg-muted",
          )}
        >
          Group by{value !== "none" ? `: ${activeLabel}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[180px] p-0">
        <div className="space-y-1 px-3 py-2">
          {OPTIONS.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={cn(
                  "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-ink bg-muted text-ink"
                    : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                      selected
                        ? "border-ink bg-ink text-bg"
                        : "border-border bg-sb text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" strokeWidth={2.2} />
                  </span>
                  <span className="text-[12px]">{option.label}</span>
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
