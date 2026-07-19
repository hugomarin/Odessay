"use client"

import { Fragment, type ReactNode } from "react"

import { ArtifactTableCard } from "@/components/shared/artifact-table-card"
import { ArtifactTableRow } from "@/components/shared/artifact-table-row"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
  /** Classes applied to the semantic table (for example a responsive min-width). */
  tableClassName?: string
  /** Shared cell rhythm for every data row in list mode. */
  rowCellClassName?: string
  /** Optional override for the leading selection cell. */
  leadingCellClassName?: string
  /** Hide column labels for dense library rows that communicate their controls directly. */
  showHeader?: boolean
  /** Tailwind grid template applied to each group in grid mode. */
  gridClassName?: string
}

/**
 * A row is navigable when an `onRowClick` is provided AND — if `getRowHref` is
 * supplied — that row actually resolves to a destination. This lets a table mix
 * navigable and read-only rows (e.g. Desk's received writings have no href).
 */
function resolveActivate<T>(
  item: T,
  href: string | null | undefined,
  getRowHref: ((item: T) => string | null | undefined) | undefined,
  onRowClick: ((item: T) => void) | undefined,
): (() => void) | undefined {
  if (!onRowClick) {
    return undefined
  }
  if (getRowHref && !href) {
    return undefined
  }
  return () => onRowClick(item)
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
  tableClassName,
  rowCellClassName,
  leadingCellClassName,
  showHeader = true,
  gridClassName = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3",
}: ArtifactTableProps<T>) {
  if (isLoading) {
    return <>{loadingState ?? <p className="px-7 py-9 text-[13px] text-ink-4">Loading…</p>}</>
  }

  const hasRows = groups.some((group) => group.items.length > 0)
  if (!hasRows) {
    return <>{emptyState ?? null}</>
  }

  if (mode === "list") {
    return (
      <div className={cn("ArtifactTable", className)}>
        <Table className={cn("table-fixed", tableClassName)}>
          <colgroup>
            {renderLeading ? <col className="w-12" /> : null}
            {columns.map((column) => <col key={column.id} className={column.width} />)}
          </colgroup>
          {showHeader ? (
            <TableHeader>
              <TableRow>
                {renderLeading ? <TableHead className="px-4"><span className="sr-only">Select</span></TableHead> : null}
                {columns.map((column) => (
                  <TableHead key={column.id} className={cn(column.align === "end" ? "text-right" : "", column.className)}>
                    {column.label ?? <span className="sr-only">Actions</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
          ) : null}
          <TableBody>
            {groups.flatMap((group, groupIndex) => {
              if (group.items.length === 0) return []
              const groupRows: ReactNode[] = []
              if (group.label) {
                groupRows.push(
                  <TableRow key={`label-${group.label}-${groupIndex}`}>
                    <TableCell colSpan={columns.length + (renderLeading ? 1 : 0)} className="bg-sb px-7 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">{group.label}</p>
                    </TableCell>
                  </TableRow>,
                )
              }
              groupRows.push(...group.items.map((item) => {
                const href = getRowHref?.(item)
                return <ArtifactTableRow key={getRowId(item)} item={item} columns={columns} href={href} ariaLabel={getRowAriaLabel?.(item)} isSelected={isRowSelected?.(item)} leading={renderLeading?.(item)} cellClassName={rowCellClassName} leadingCellClassName={leadingCellClassName} onActivate={resolveActivate(item, href, getRowHref, onRowClick)} />
              }))
              return groupRows
            })}
          </TableBody>
        </Table>
      </div>
    )
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
                  const href = getRowHref?.(item)
                  return (
                    <ArtifactTableCard
                      key={getRowId(item)}
                      item={item}
                      columns={columns}
                      href={href}
                      ariaLabel={getRowAriaLabel?.(item)}
                      isSelected={isRowSelected?.(item)}
                      leading={renderLeading?.(item)}
                      onActivate={resolveActivate(item, href, getRowHref, onRowClick)}
                    />
                  )
                })}
              </div>
            ) : (
              <Table className={tableClassName}>
                {groupIndex === 0 ? (
                  <TableHeader>
                    <TableRow>
                      {renderLeading ? <TableHead className="w-10 px-4"><span className="sr-only">Select</span></TableHead> : null}
                      {columns.map((column) => (
                        <TableHead key={column.id} className={cn(column.align === "end" ? "text-right" : "", column.className)}>
                          {column.label ?? <span className="sr-only">Actions</span>}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                ) : null}
                <TableBody>
                {group.items.map((item) => {
                  const href = getRowHref?.(item)
                  return (
                    <ArtifactTableRow
                      key={getRowId(item)}
                      item={item}
                      columns={columns}
                      href={href}
                      ariaLabel={getRowAriaLabel?.(item)}
                      isSelected={isRowSelected?.(item)}
                      leading={renderLeading?.(item)}
                      cellClassName={rowCellClassName}
                      leadingCellClassName={leadingCellClassName}
                      onActivate={resolveActivate(item, href, getRowHref, onRowClick)}
                    />
                  )
                })}
                </TableBody>
              </Table>
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
