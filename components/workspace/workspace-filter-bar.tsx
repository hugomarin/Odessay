"use client"

import type { ReactNode } from "react"
import { ArrowUpDown, ChevronDown, LayoutGrid, List, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type WorkspaceFilterBarView = "grid" | "list"
export type WorkspaceFilterBarSort = "newest" | "oldest" | "name"

export type WorkspaceFilterBarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  sortBy: WorkspaceFilterBarSort
  onSortChange: (value: WorkspaceFilterBarSort) => void
  view?: WorkspaceFilterBarView
  onViewChange?: (value: WorkspaceFilterBarView) => void
  className?: string
}

const SORT_OPTIONS: { value: WorkspaceFilterBarSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name" },
]

const VIEW_OPTIONS: { value: WorkspaceFilterBarView; label: string; icon: ReactNode }[] = [
  {
    value: "grid",
    label: "Grid",
    icon: <LayoutGrid className="h-[15px] w-[15px]" strokeWidth={1.5} />,
  },
  {
    value: "list",
    label: "List",
    icon: <List className="h-[15px] w-[15px]" strokeWidth={1.5} />,
  },
]

/** 38px, radius 9, hairline border; tinted while its menu is open. */
function toolButtonClass(active: boolean, open: boolean): string {
  return cn(
    "inline-flex h-[38px] flex-shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[9px]",
    "border-[0.5px] px-[13px] text-[16px] text-ink-2 transition-colors",
    open || active
      ? "border-ink-5 bg-surface-menu-hover"
      : "border-border bg-sb hover:bg-surface-menu-hover",
  )
}

function MenuChoice({
  selected,
  children,
  onClick,
}: {
  selected: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center rounded-[6px] px-2.5 text-left text-[13px] transition-colors hover:bg-surface-menu-hover",
        selected ? "font-medium text-ink" : "font-normal text-ink-2",
      )}
    >
      {children}
    </button>
  )
}

export function WorkspaceFilterBar({
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  view,
  onViewChange,
  className,
}: WorkspaceFilterBarProps) {
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? "Newest first"

  return (
    <div
      data-testid="workspace-filter-bar"
      className={cn(
        "flex flex-shrink-0 flex-wrap items-center gap-[14px]",
        className,
      )}
    >
      <span className="flex h-[38px] min-w-[160px] flex-1 items-center gap-[9px] rounded-[9px] border-[0.5px] border-border bg-sb px-3">
        <Search className="h-[15px] w-[15px] flex-shrink-0 text-ink-5" strokeWidth={1.5} />
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter by name…"
          aria-label="Filter by name"
          data-testid="workspace-filter-search"
          className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-5"
        />
      </span>

      <div className="flex flex-shrink-0 items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="workspace-sort-trigger"
              className={toolButtonClass(false, false)}
            >
              <ArrowUpDown className="h-[15px] w-[15px]" strokeWidth={1.5} />
              Sort: {sortLabel}
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[200px] p-[5px]">
            {SORT_OPTIONS.map((option) => (
              <MenuChoice
                key={option.value}
                selected={sortBy === option.value}
                onClick={() => onSortChange(option.value)}
              >
                {option.label}
              </MenuChoice>
            ))}
          </PopoverContent>
        </Popover>

        {view && onViewChange ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="workspace-view-trigger"
                className={toolButtonClass(false, false)}
              >
                {view === "grid" ? (
                  <LayoutGrid className="h-[15px] w-[15px]" strokeWidth={1.5} />
                ) : (
                  <List className="h-[15px] w-[15px]" strokeWidth={1.5} />
                )}
                View: {view === "grid" ? "Grid" : "List"}
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[160px] p-[5px]">
              {VIEW_OPTIONS.map((option) => (
                <MenuChoice
                  key={option.value}
                  selected={view === option.value}
                  onClick={() => onViewChange(option.value)}
                >
                  <span className="flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </span>
                </MenuChoice>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}
