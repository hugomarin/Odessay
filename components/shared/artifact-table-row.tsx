"use client"

import { memo, type KeyboardEvent, type ReactNode } from "react"

import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types"
import { cn } from "@/lib/utils"

type ArtifactTableRowProps<T> = {
  item: T
  columns: ArtifactTableColumn<T>[]
  href?: string | null
  ariaLabel?: string
  isSelected?: boolean
  leading?: ReactNode
  onActivate?: () => void
}

/**
 * A single list-mode row built entirely from flex divs (no HTML `<table>`).
 * Memoized so that, given stable `columns`/handler references from the consumer,
 * only the row whose `item` reference changed re-renders.
 */
function ArtifactTableRowInner<T>({
  item,
  columns,
  href,
  ariaLabel,
  isSelected,
  leading,
  onActivate,
}: ArtifactTableRowProps<T>) {
  const isNavigable = Boolean(onActivate)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isNavigable) {
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onActivate?.()
    }
  }

  return (
    <div
      role={isNavigable ? "link" : "row"}
      aria-label={ariaLabel}
      aria-current={isSelected ? "true" : undefined}
      data-href={href ?? undefined}
      tabIndex={isNavigable ? 0 : -1}
      onClick={isNavigable ? onActivate : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex items-center gap-3 bg-sb px-7 py-[18px] transition-colors",
        "[&:not(:first-child)]:border-t-[0.5px] [&:not(:first-child)]:border-border",
        isNavigable
          ? "cursor-pointer hover:bg-[hsl(var(--sb))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
          : "cursor-default",
      )}
    >
      {leading != null ? <div className="shrink-0">{leading}</div> : null}
      {columns.map((column) => (
        <div
          key={column.id}
          className={cn(
            "min-w-0",
            column.grow ? "flex-1" : "shrink-0",
            column.align === "end" ? "flex justify-end text-right" : "",
            column.width,
            column.className,
          )}
        >
          {column.render(item)}
        </div>
      ))}
    </div>
  )
}

export const ArtifactTableRow = memo(ArtifactTableRowInner) as typeof ArtifactTableRowInner
