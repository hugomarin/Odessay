"use client"

import { memo, type KeyboardEvent, type ReactNode } from "react"

import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types"
import { TableCell, TableRow } from "@/components/ui/table"
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

function ArtifactTableRowInner<T>({ item, columns, href, ariaLabel, isSelected, leading, onActivate }: ArtifactTableRowProps<T>) {
  const isNavigable = Boolean(onActivate)
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (isNavigable && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault()
      onActivate?.()
    }
  }

  return (
    <TableRow
      role={isNavigable ? "link" : "row"}
      aria-label={ariaLabel}
      aria-current={isSelected ? "true" : undefined}
      data-href={href ?? undefined}
      tabIndex={isNavigable ? 0 : -1}
      onClick={isNavigable ? onActivate : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "group",
        isNavigable
          ? "cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
          : "cursor-default",
      )}
    >
      {leading != null ? <TableCell className="w-12 pl-5 pr-1 align-top pt-[1.15rem] sm:pl-9">{leading}</TableCell> : null}
      {columns.map((column) => (
        <TableCell key={column.id} className={cn("min-w-0", column.align === "end" ? "text-right" : "", column.className)}>
          {column.render(item)}
        </TableCell>
      ))}
    </TableRow>
  )
}

export const ArtifactTableRow = memo(ArtifactTableRowInner) as typeof ArtifactTableRowInner
