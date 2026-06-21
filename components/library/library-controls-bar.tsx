"use client"

import { type ReactNode } from "react"
import { ArrowDownUp, ChevronDown, Filter, Group, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type LibraryControlsBarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  filterContent: ReactNode
  groupContent: ReactNode
  sortLabel: string
  sortContent: ReactNode
  filterActive?: boolean
  groupActive?: boolean
  leading?: ReactNode
  className?: string
}

/** Shared, compact controls for table-oriented library surfaces. */
export function LibraryControlsBar({
  searchQuery,
  onSearchChange,
  filterContent,
  groupContent,
  sortLabel,
  sortContent,
  filterActive = false,
  groupActive = false,
  leading,
  className,
}: LibraryControlsBarProps) {
  return (
    <div className={cn("LibraryControlsBar", className)} data-testid="library-controls-bar">
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
        <div className="relative min-w-[200px] flex-1 sm:w-[360px] sm:flex-none">
          <Search className="absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ink-4" strokeWidth={1.5} />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter by name..."
            className="h-9 rounded-[8px] border-transparent bg-muted/70 pl-9 pr-8 text-[13px] font-sans text-ink placeholder:text-ink-4 shadow-none"
          />
          {searchQuery ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onSearchChange("")}
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-[6px] text-ink-4"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </Button>
          ) : null}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className={cn("h-9 gap-2 rounded-[8px] px-3 text-[13px]", filterActive ? "bg-muted text-ink" : "bg-muted/70")}>
              <Filter className="h-[14px] w-[14px]" strokeWidth={1.5} />
              Filter
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[260px] p-2">{filterContent}</PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className={cn("h-9 gap-2 rounded-[8px] px-3 text-[13px]", groupActive ? "bg-muted text-ink" : "bg-muted/70")}>
              <Group className="h-[14px] w-[14px]" strokeWidth={1.5} />
              Group by
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[220px] p-2">{groupContent}</PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-2 rounded-[8px] bg-muted/70 px-3 text-[13px]">
              <ArrowDownUp className="h-[14px] w-[14px]" strokeWidth={1.5} />
              Sort: {sortLabel}
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[220px] p-2">
            {sortContent}
          </PopoverContent>
        </Popover>
        </div>
      </div>

    </div>
  )
}
