"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Download, Search, Trash2, Undo2 } from "lucide-react"

import type { DocumentService, WritingSummary } from "@/lib/services/contracts/document-service"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { SelectionBar } from "@/components/shared/selection-bar"
import { hasCloudRecord } from "@/lib/writings/document-state"
import { cn } from "@/lib/utils"
import { ArchivedWritingActions } from "./archived-writing-actions"
import { PermanentDeleteWritingDialog } from "./permanent-delete-writing-dialog"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 25
type ArchiveAction = "restore" | "download" | "delete"
export type ArchivedWritingsService = Pick<DocumentService, "listWritings" | "restoreWriting" | "permanentlyDeleteWriting" | "downloadWriting">
type RowError = { action: ArchiveAction; message: string }

const SCOPES = ["All", "Cloud", "Local"] as const
type Scope = (typeof SCOPES)[number]

const actionLabel: Record<ArchiveAction, string> = {
  restore: "Restoring…",
  download: "Downloading…",
  delete: "Deleting…",
}

const actionError: Record<ArchiveAction, string> = {
  restore: "Could not restore this artifact.",
  download: "Could not download this artifact.",
  delete: "Could not permanently delete this artifact.",
}

/**
 * Origin, from the one derivation the app shares.
 *
 * `WritingSummary` carries `lifecycle` but not `canonicalPath`, so this splits
 * on cloud presence alone — the `hasLocalFile` half of
 * `deriveDocumentStateFromSignals` has no input in this projection. Recorded in
 * the ODE-432 PR as a data gap: a true Cloud/Local split needs the archived
 * query to carry the canonical path.
 */
function isCloudArchived(row: WritingSummary): boolean {
  return row.lifecycle ? hasCloudRecord(row.lifecycle) : true
}

function Checkbox({ checked, indeterminate, label, onChange }: {
  checked: boolean
  indeterminate?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors",
        checked || indeterminate ? "border-ink bg-ink" : "border-ink-6 bg-sb",
      )}
    >
      <Check
        className={cn("h-3 w-3 text-white", checked && !indeterminate ? "opacity-100" : "opacity-0")}
        strokeWidth={3}
      />
      <span
        aria-hidden
        className={cn(
          "absolute h-[1.5px] w-[9px] rounded-[1px] bg-white",
          indeterminate ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  )
}

export function ArchivedWritingsList({ service: suppliedService }: { service?: ArchivedWritingsService }) {
  const [rows, setRows] = useState<WritingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({})
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [busyActions, setBusyActions] = useState<Record<string, ArchiveAction>>({})
  const [deleteTarget, setDeleteTarget] = useState<WritingSummary | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<Scope>("All")
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const resolveService = useCallback(
    async (): Promise<ArchivedWritingsService> => suppliedService ?? getDocumentService(),
    [suppliedService],
  )

  const load = useCallback(async (nextOffset = 0) => {
    setLoading(true)
    setLoadError(null)
    const service = await resolveService()
    const result = await service.listWritings({
      includeDeleted: true,
      archivedOnly: true,
      limit: PAGE_SIZE + 1,
      offset: nextOffset,
    })
    if (result.error) {
      setLoadError(result.error.message)
    } else {
      const next = result.data ?? []
      setRows(next.slice(0, PAGE_SIZE))
      setHasMore(next.length > PAGE_SIZE)
      setOffset(nextOffset)
    }
    setLoading(false)
  }, [resolveService])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      const matchesScope =
        scope === "All" || (scope === "Cloud" ? isCloudArchived(row) : !isCloudArchived(row))
      if (!matchesScope) return false
      if (!needle) return true
      return (row.title ?? "Untitled").toLowerCase().includes(needle)
    })
  }, [rows, query, scope])

  // A row filtered out of view must not stay selected behind the filter, or the
  // bar would act on artifacts the user can no longer see.
  const selectedRows = useMemo(
    () => visible.filter((row) => selected[row.id]),
    [visible, selected],
  )
  const allVisibleSelected = visible.length > 0 && selectedRows.length === visible.length
  const someVisibleSelected = selectedRows.length > 0 && !allVisibleSelected

  const clearRowError = (writingId: string) => {
    setRowErrors((current) => {
      const next = { ...current }
      delete next[writingId]
      return next
    })
  }

  const finishAction = (writingId: string) => {
    setBusyActions((current) => {
      const next = { ...current }
      delete next[writingId]
      return next
    })
  }

  const downloadRow = async (service: ArchivedWritingsService, row: WritingSummary) => {
    const result = await service.downloadWriting({ writingId: row.id })
    if (result.error) return false
    if (result.data) {
      const bytes = Uint8Array.from(result.data.bytes)
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.data.mimeType }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = result.data.fileName
      anchor.click()
      URL.revokeObjectURL(url)
    }
    return true
  }

  const run = async (row: WritingSummary, action: ArchiveAction) => {
    setBusyActions((current) => ({ ...current, [row.id]: action }))
    clearRowError(row.id)
    const service = await resolveService()

    if (action === "download") {
      const ok = await downloadRow(service, row)
      if (!ok) setRowErrors((current) => ({ ...current, [row.id]: { action, message: actionError[action] } }))
      finishAction(row.id)
      return
    }

    const result = action === "restore"
      ? await service.restoreWriting({ writingId: row.id, version: row.version, updatedAt: new Date().toISOString() })
      : await service.permanentlyDeleteWriting({ writingId: row.id })

    if (result.error) {
      setRowErrors((current) => ({ ...current, [row.id]: { action, message: actionError[action] } }))
      if (action === "delete") setDeleteTarget(null)
    } else {
      clearRowError(row.id)
      if (action === "delete") setDeleteTarget(null)
      await load(offset)
    }
    finishAction(row.id)
  }

  /**
   * Bulk actions run per row and keep failures on their own row, so a partial
   * failure reports exactly which artifacts did not move instead of collapsing
   * into one banner. The rows that succeeded leave the selection; the ones that
   * failed stay selected so the action can be retried from the bar.
   */
  const runBulk = async (action: ArchiveAction) => {
    const targets = selectedRows
    if (targets.length === 0) return
    const service = await resolveService()
    const failed: Record<string, boolean> = {}

    setBusyActions(Object.fromEntries(targets.map((row) => [row.id, action])))

    for (const row of targets) {
      const ok = action === "download"
        ? await downloadRow(service, row)
        : !(action === "restore"
          ? await service.restoreWriting({ writingId: row.id, version: row.version, updatedAt: new Date().toISOString() })
          : await service.permanentlyDeleteWriting({ writingId: row.id })).error

      if (ok) {
        clearRowError(row.id)
      } else {
        failed[row.id] = true
        setRowErrors((current) => ({ ...current, [row.id]: { action, message: actionError[action] } }))
      }
    }

    setBusyActions({})
    setSelected(failed)
    setBulkDeleteOpen(false)
    if (action !== "download") await load(offset)
  }

  const retry = (row: WritingSummary, error: RowError) => {
    if (error.action === "delete") {
      clearRowError(row.id)
      setDeleteTarget(row)
      return
    }
    void run(row, error.action)
  }

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelected({})
      return
    }
    setSelected(Object.fromEntries(visible.map((row) => [row.id, true])))
  }

  return (
    <div
      id="archived-writings-list"
      data-section="archived-writings-list"
      data-testid="archived-writings-list"
    >
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <span className="flex h-[38px] min-w-[180px] flex-1 items-center gap-[9px] rounded-[9px] border-[0.5px] border-border px-3">
          <Search className="h-[15px] w-[15px] flex-shrink-0 text-ink-5" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the archive…"
            aria-label="Search the archive"
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] leading-none text-ink outline-none placeholder:text-ink-5"
          />
        </span>
        {SCOPES.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setScope(entry)}
            aria-pressed={scope === entry}
            className={cn(
              "inline-flex h-[38px] items-center rounded-[9px] border-[0.5px] px-3.5 text-[13px] transition-colors",
              scope === entry
                ? "border-ink-5 bg-surface-menu-hover font-medium text-ink"
                : "border-border bg-sb font-normal text-ink-2 hover:bg-surface-menu-hover hover:text-ink",
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      {loading ? (
        <div role="status" aria-label="Loading archived artifacts" className="space-y-2">
          {[0, 1, 2].map((index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border-[0.5px] border-border p-4 text-[13px] text-ink-3">
          <p>Could not load archived artifacts. {loadError}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void load(offset)}>Retry</Button>
        </div>
      ) : (
        <>
          <div className="mb-1 flex h-11 items-center gap-3 rounded-lg bg-surface-selected pl-3.5 pr-2">
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              label="Select all"
              onChange={toggleAll}
            />
            <span className="min-w-0 flex-1 text-[13px] font-medium leading-none text-ink">
              {visible.length} archived{scope === "All" ? "" : ` · ${scope}`}
            </span>
            {visible.length > 0 && !allVisibleSelected ? (
              <button
                type="button"
                onClick={() => setSelected(Object.fromEntries(visible.map((row) => [row.id, true])))}
                className="inline-flex h-8 items-center rounded-md border-[0.5px] border-border bg-sb px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted-hover hover:text-ink"
              >
                Select the {visible.length} visible
              </button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <div className="py-[60px] text-center">
              <p className="mb-1 text-[16px] font-medium leading-tight text-ink">Nothing here</p>
              <p className="text-[13px] leading-normal text-ink-4">
                No archived artifact matches that filter.
              </p>
            </div>
          ) : (
            <div>
              {visible.map((row) => {
                const rowError = rowErrors[row.id]
                const busyAction = busyActions[row.id]
                const rowBusy = Boolean(busyAction)
                const cloud = isCloudArchived(row)
                const isSelected = Boolean(selected[row.id])

                return (
                  <div
                    key={row.id}
                    data-testid={`archived-writing-${row.id}`}
                    className="flex items-center gap-3.5 border-b-[0.5px] border-line-softer py-[13px] pl-3.5 pr-2 transition-colors hover:bg-surface-row-hover"
                  >
                    <Checkbox
                      checked={isSelected}
                      label={`Select ${row.title || "Untitled"}`}
                      onChange={() => setSelected((current) => ({ ...current, [row.id]: !isSelected }))}
                    />

                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="truncate text-[14px] font-medium leading-tight text-ink">
                        {row.title || "Untitled"}
                      </span>
                      <span className="text-[12px] leading-[1.4] text-ink-5">
                        {busyAction
                          ? actionLabel[busyAction]
                          : `Archived ${row.deletedAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(row.deletedAt)) : "recently"}`}
                      </span>
                      {rowError ? (
                        <span role="alert" className="mt-1 flex items-center gap-2 text-[12px] text-destructive">
                          <span>{rowError.message}</span>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[12px]" onClick={() => retry(row, rowError)}>Retry</Button>
                        </span>
                      ) : null}
                    </span>

                    <span
                      className={cn(
                        "inline-flex h-6 flex-shrink-0 items-center rounded-pill px-2.5 text-[12px] font-normal leading-none",
                        row.archiveState === "pending-deletion" || row.archiveState === "error"
                          ? "bg-danger-surface text-cursor"
                          : cloud
                            ? "bg-surface-menu-hover text-ink-3"
                            : "bg-danger-surface text-cursor",
                      )}
                    >
                      {row.archiveState === "pending-deletion"
                        ? "Pending deletion"
                        : row.archiveState === "error"
                          ? "Deletion failed"
                          : cloud
                            ? "Cloud archived"
                            : "Local file"}
                    </span>

                    <ArchivedWritingActions
                      disabled={rowBusy}
                      onDownload={() => void run(row, "download")}
                      onRestore={() => void run(row, "restore")}
                      onDelete={() => setDeleteTarget(row)}
                    />
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4 flex justify-between">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => void load(offset + PAGE_SIZE)}>Next</Button>
          </div>
        </>
      )}

      <SelectionBar
        placement="absolute"
        selectedCount={selectedRows.length}
        onDeselectAll={() => setSelected({})}
        actions={[
          {
            id: "restore",
            label: "Restore",
            icon: <Undo2 className="h-[15px] w-[15px]" strokeWidth={1.5} />,
            onSelect: () => runBulk("restore"),
          },
          {
            id: "download",
            label: "Download",
            icon: <Download className="h-[15px] w-[15px]" strokeWidth={1.5} />,
            onSelect: () => runBulk("download"),
          },
          {
            id: "delete-forever",
            label: "Delete forever",
            destructive: true,
            icon: <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.5} />,
            onSelect: () => setBulkDeleteOpen(true),
          },
        ]}
      />

      <PermanentDeleteWritingDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.title || "Untitled"}
        busy={Boolean(deleteTarget && busyActions[deleteTarget.id] === "delete")}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        onConfirm={() => { if (deleteTarget) void run(deleteTarget, "delete") }}
      />

      <PermanentDeleteWritingDialog
        open={bulkDeleteOpen}
        title={selectedRows[0]?.title || "Untitled"}
        count={selectedRows.length}
        busy={Object.keys(busyActions).length > 0}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={() => void runBulk("delete")}
      />
    </div>
  )
}
