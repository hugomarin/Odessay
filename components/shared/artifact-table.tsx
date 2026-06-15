"use client"

import { Fragment, type ReactNode } from "react"

import { ArtifactTableCard } from "@/components/shared/artifact-table-card"
import { ArtifactTableRow } from "@/components/shared/artifact-table-row"
import type {
  ArtifactTableColumn,
  ArtifactTableGroup,
  ArtifactTableMode,
} from "@/components/shared/artifact-table-types"
import { cn } from "@/lib/utils"

export type ArtifactTableProps<T> = {
  /** Grouped rows. Pass a single group with no label for an ungrouped table. */
  groups: ArtifactTableGroup<T>[]
  columns: ArtifactTableColumn<T>[]
  mode?: ArtifactTableMode
  getRowId: (item: T) => string
  /** Destination href used for accessibility metadata; navigation runs via onRowClick. */
  getRowHref?: (item: T) => string | null | undefined
  onRowClick?: (item: T) => void
  getRowAriaLabel?: (item: T) => string
  isRowSelected?: (item: T) => boolean
  /** Leading cell (e.g. a selection checkbox) rendered before the columns. */
  renderLeading?: (item: T) => ReactNode
  isLoading?: boolean
  loadingState?: ReactNode
  emptyState?: ReactNode
  className?: string
  /** Tailwind grid template applied to each group in grid mode. */
  gridClassName?: string
}

export function ArtifactTable<T>({
  groups,
  columns,
  mode = "list",
  getRowId,
  getRowHref,
  onRowClick,
  getRowAriaLabel,
  isRowSelected,
  renderLeading,
  isLoading = false,
  loadingState,
  emptyState,
  className,
  gridClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3",
}: ArtifactTableProps<T>) {
  if (isLoading) {
    return <>{loadingState ?? <p className="px-7 py-9 text-[13px] text-ink-4">Loading…</p>}</>
  }

  const hasRows = groups.some((group) => group.items.length > 0)
  if (!hasRows) {
    return <>{emptyState ?? null}</>
  }

  return (
    <div className={cn("ArtifactTable", className)}>
      {groups.map((group, groupIndex) => {
        if (group.items.length === 0) {
          return null
        }

        return (
          <Fragment key={group.label || `artifact-group-${groupIndex}`}>
            {group.label ? (
              <div className="bg-sb px-7 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">
                  {group.label}
                </p>
              </div>
            ) : null}

            {mode === "grid" ? (
              <div className={cn(gridClassName, "px-1 py-2")}>
                {group.items.map((item) => {
                  const id = getRowId(item)
                  return (
                    <ArtifactTableCard
                      key={id}
                      item={item}
                      columns={columns}
                      href={getRowHref?.(item)}
                      ariaLabel={getRowAriaLabel?.(item)}
                      isSelected={isRowSelected?.(item)}
                      leading={renderLeading?.(item)}
                      onActivate={onRowClick ? () => onRowClick(item) : undefined}
                    />
                  )
                })}
              </div>
            ) : (
              <div>
                {group.items.map((item) => {
                  const id = getRowId(item)
                  return (
                    <ArtifactTableRow
                      key={id}
                      item={item}
                      columns={columns}
                      href={getRowHref?.(item)}
                      ariaLabel={getRowAriaLabel?.(item)}
                      isSelected={isRowSelected?.(item)}
                      leading={renderLeading?.(item)}
                      onActivate={onRowClick ? () => onRowClick(item) : undefined}
                    />
                  )
                })}
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

export type {
  ArtifactAction,
  ArtifactColumnId,
  ArtifactTableColumn,
  ArtifactTableGroup,
  ArtifactTableItem,
  ArtifactTableMode,
} from "@/components/shared/artifact-table-types"
