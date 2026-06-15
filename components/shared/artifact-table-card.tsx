"use client"

import { memo, type KeyboardEvent, type ReactNode } from "react"

import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types"
import { cn } from "@/lib/utils"

type ArtifactTableCardProps<T> = {
  item: T
  columns: ArtifactTableColumn<T>[]
  href?: string | null
  ariaLabel?: string
  isSelected?: boolean
  leading?: ReactNode
  onActivate?: () => void
}

/**
 * Grid-mode card. Renders the same columns as the list row but stacked
 * vertically: the `title` column anchors the card, the `actions` column pins to
 * the footer, and every other enabled column flows in between. Memoized for the
 * same per-item re-render guarantee as the row.
 */
function ArtifactTableCardInner<T>({
  item,
  columns,
  href,
  ariaLabel,
  isSelected,
  leading,
  onActivate,
}: ArtifactTableCardProps<T>) {
  const isNavigable = Boolean(onActivate)
  const titleColumn = columns.find((column) => column.id === "title")
  const actionsColumn = columns.find((column) => column.id === "actions")
  const bodyColumns = columns.filter(
    (column) => column.id !== "title" && column.id !== "actions",
  )

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
      role={isNavigable ? "link" : "group"}
      aria-label={ariaLabel}
      aria-current={isSelected ? "true" : undefined}
      data-href={href ?? undefined}
      tabIndex={isNavigable ? 0 : -1}
      onClick={isNavigable ? onActivate : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex h-full flex-col gap-3 rounded-[14px] border-[0.5px] border-border bg-sb p-5 transition-colors",
        isNavigable
          ? "cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
          : "cursor-default",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{titleColumn?.render(item)}</div>
        {leading != null ? <div className="shrink-0">{leading}</div> : null}
      </div>

      {bodyColumns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {bodyColumns.map((column) => (
            <div key={column.id} className={cn("min-w-0", column.className)}>
              {column.render(item)}
            </div>
          ))}
        </div>
      ) : null}

      {actionsColumn ? (
        <div className="mt-auto flex items-center justify-end pt-1">{actionsColumn.render(item)}</div>
      ) : null}
    </div>
  )
}

export const ArtifactTableCard = memo(ArtifactTableCardInner) as typeof ArtifactTableCardInner

export type { ArtifactTableCardProps }
