"use client"

import { useCallback, useEffect, useState } from "react"
import type { DocumentService, WritingSummary } from "@/lib/services/contracts/document-service"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { ArchivedWritingActions } from "./archived-writing-actions"
import { PermanentDeleteWritingDialog } from "./permanent-delete-writing-dialog"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 25
type ArchiveAction = "restore" | "download" | "delete"
export type ArchivedWritingsService = Pick<DocumentService, "listWritings" | "restoreWriting" | "permanentlyDeleteWriting" | "downloadWriting">
type RowError = { action: ArchiveAction; message: string }

const actionLabel: Record<ArchiveAction, string> = {
  restore: "Restoring…",
  download: "Downloading…",
  delete: "Deleting…",
}

const actionError: Record<ArchiveAction, string> = {
  restore: "Could not restore this writing.",
  download: "Could not download this writing.",
  delete: "Could not permanently delete this writing.",
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

  const run = async (row: WritingSummary, action: ArchiveAction) => {
    setBusyActions((current) => ({ ...current, [row.id]: action }))
    clearRowError(row.id)
    const service = await resolveService()

    if (action === "download") {
      const result = await service.downloadWriting({ writingId: row.id })
      if (result.error) {
        setRowErrors((current) => ({ ...current, [row.id]: { action, message: actionError[action] } }))
      } else if (result.data) {
        const bytes = Uint8Array.from(result.data.bytes)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.data.mimeType }))
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = result.data.fileName
        anchor.click()
        URL.revokeObjectURL(url)
      }
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

  const retry = (row: WritingSummary, error: RowError) => {
    if (error.action === "delete") {
      clearRowError(row.id)
      setDeleteTarget(row)
      return
    }
    void run(row, error.action)
  }

  if (loading) {
    return <div role="status" aria-label="Loading archived writings" className="space-y-2">
      {[0, 1, 2].map((index) => <div key={index} className="h-16 animate-pulse rounded-[8px] bg-sb" />)}
    </div>
  }
  if (loadError) {
    return <div role="alert" className="rounded-[8px] border-[0.5px] border-border p-4 text-[13px] text-ink-3">
      <p>Could not load archived writings. {loadError}</p>
      <Button className="mt-3" size="sm" variant="outline" onClick={() => void load(offset)}>Retry</Button>
    </div>
  }
  if (rows.length === 0) {
    return <div className="rounded-[10px] border-[0.5px] border-dashed border-border px-5 py-10 text-center">
      <p className="font-lora text-[17px] text-ink">No archived writings</p>
      <p className="mt-1 text-[13px] text-ink-4">Soft-deleted writings will appear here.</p>
    </div>
  }

  return <div id="archived-writings-list" data-section="archived-writings-list" data-testid="archived-writings-list" className="ArchivedWritingsList">
    <div className="divide-y-[0.5px] divide-border border-y-[0.5px] border-border">
      {rows.map((row) => {
        const rowError = rowErrors[row.id]
        const busyAction = busyActions[row.id]
        const rowBusy = Boolean(busyAction)
        return <div key={row.id} data-testid={`archived-writing-${row.id}`} className="flex min-h-16 items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-ink">{row.title || "Untitled"}</p>
            <p className="mt-1 text-[12px] text-ink-4">Archived {row.deletedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(row.deletedAt)) : "recently"}</p>
            {rowError ? <div role="alert" className="mt-2 flex items-center gap-2 text-[12px] text-destructive">
              <span>{rowError.message}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[12px]" onClick={() => retry(row, rowError)}>Retry</Button>
            </div> : null}
          </div>
          <span className="text-[12px] text-ink-4">
            {busyAction ? actionLabel[busyAction] : row.archiveState === "pending-deletion" ? "Pending deletion" : row.archiveState === "error" ? "Deletion failed — retry" : "Cloud archived"}
          </span>
          <ArchivedWritingActions disabled={rowBusy} onDownload={() => void run(row, "download")} onRestore={() => void run(row, "restore")} onDelete={() => setDeleteTarget(row)} />
        </div>
      })}
    </div>
    <div className="mt-4 flex justify-between">
      <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
      <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => void load(offset + PAGE_SIZE)}>Next</Button>
    </div>
    <PermanentDeleteWritingDialog
      open={Boolean(deleteTarget)}
      title={deleteTarget?.title || "Untitled"}
      busy={Boolean(deleteTarget && busyActions[deleteTarget.id] === "delete")}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      onConfirm={() => { if (deleteTarget) void run(deleteTarget, "delete") }}
    />
  </div>
}
