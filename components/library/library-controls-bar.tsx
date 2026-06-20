"use client"

import { type ReactNode, useState } from "react"
import { ArrowDownUp, ChevronDown, Filter, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type ControlSection = "filter" | "group" | null

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

/** Shared two-level controls for table-oriented library surfaces. */
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
  const [activeSection, setActiveSection] = useState<ControlSection>(null)

  const toggleSection = (section: Exclude<ControlSection, null>) => {
    setActiveSection((current) => (current === section ? null : section))
  }

  return (
    <div className={cn("LibraryControlsBar space-y-2", className)} data-testid="library-controls-bar">
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <div className="relative min-w-[200px] flex-1">
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => toggleSection("filter")}
          aria-expanded={activeSection === "filter"}
          className={cn("h-9 gap-2 rounded-[8px] px-3 text-[13px]", filterActive || activeSection === "filter" ? "bg-muted text-ink" : "bg-muted/70")}
        >
          <Filter className="h-[14px] w-[14px]" strokeWidth={1.5} />
          Filter
          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => toggleSection("group")}
          aria-expanded={activeSection === "group"}
          className={cn("h-9 gap-2 rounded-[8px] px-3 text-[13px]", groupActive || activeSection === "group" ? "bg-muted text-ink" : "bg-muted/70")}
        >
          Group by
          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
        </Button>
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

      {activeSection ? (
        <div className="border-t-[0.5px] border-border pt-2" data-testid={`library-controls-${activeSection}-panel`}>
          {activeSection === "filter" ? filterContent : groupContent}
        </div>
      ) : null}
    </div>
  )
}
