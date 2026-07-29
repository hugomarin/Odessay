"use client"

import { useCallback, useEffect, useState } from "react"
import type { WritingSummary } from "@/lib/services/contracts/document-service"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { ArchivedWritingActions } from "./archived-writing-actions"
import { PermanentDeleteWritingDialog } from "./permanent-delete-writing-dialog"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 25

export function ArchivedWritingsList() {
  const [rows, setRows] = useState<WritingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WritingSummary | null>(null)

  const load = useCallback(async (nextOffset = 0) => {
    setLoading(true); setError(null)
    const service = await getDocumentService()
    const result = await service.listWritings({ includeDeleted: true, archivedOnly: true, limit: PAGE_SIZE + 1, offset: nextOffset })
    if (result.error) setError(result.error.message)
    else { const next = result.data ?? []; setRows(next.slice(0, PAGE_SIZE)); setHasMore(next.length > PAGE_SIZE); setOffset(nextOffset) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const run = async (row: WritingSummary, action: "restore" | "download" | "delete") => {
    setBusyId(row.id); setError(null)
    const service = await getDocumentService()
    if (action === "download") {
      const result = await service.downloadWriting({ writingId: row.id })
      if (result.error) setError(result.error.message)
      else if (result.data) { const url = URL.createObjectURL(new Blob([Uint8Array.from(result.data.bytes).buffer], { type: result.data.mimeType })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.data.fileName; anchor.click(); URL.revokeObjectURL(url) }
      setBusyId(null); return
    }
    const result = action === "restore" ? await service.restoreWriting({ writingId: row.id, updatedAt: new Date().toISOString() }) : await service.permanentlyDeleteWriting({ writingId: row.id })
    if (result.error) setError(result.error.message); else { await load(offset); if (action === "delete") setDeleteTarget(null) }
    setBusyId(null)
  }

  if (loading) return <p role="status" className="text-[13px] text-ink-4">Loading archived writings…</p>
  if (error && rows.length === 0) return <div role="alert" className="rounded-[8px] border-[0.5px] border-border p-4 text-[13px] text-ink-3"><p>Could not load archived writings. {error}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void load(offset)}>Retry</Button></div>
  if (rows.length === 0) return <div className="rounded-[10px] border-[0.5px] border-dashed border-border px-5 py-10 text-center"><p className="font-lora text-[17px] text-ink">No archived writings</p><p className="mt-1 text-[13px] text-ink-4">Soft-deleted writings will appear here.</p></div>

  return <div id="archived-writings-list" data-section="archived-writings-list" data-testid="archived-writings-list" className="ArchivedWritingsList">
    {error ? <p role="alert" className="mb-3 text-[13px] text-destructive">{error}</p> : null}
    <div className="divide-y-[0.5px] divide-border border-y-[0.5px] border-border">
      {rows.map((row) => <div key={row.id} className="flex min-h-16 items-center gap-4 py-3">
        <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium text-ink">{row.title || "Untitled"}</p><p className="mt-1 text-[12px] text-ink-4">Archived {row.deletedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(row.deletedAt)) : "recently"}</p></div>
        <span className="text-[12px] text-ink-4">{busyId === row.id ? "Working…" : row.archiveState === "pending-deletion" ? "Pending deletion" : row.archiveState === "error" ? "Deletion failed — retry" : "Cloud archived"}</span>
        <ArchivedWritingActions disabled={busyId !== null} onDownload={() => void run(row, "download")} onRestore={() => void run(row, "restore")} onDelete={() => setDeleteTarget(row)} />
      </div>)}
    </div>
    <div className="mt-4 flex justify-between"><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>Previous</Button><Button variant="outline" size="sm" disabled={!hasMore} onClick={() => void load(offset + PAGE_SIZE)}>Next</Button></div>
    <PermanentDeleteWritingDialog open={Boolean(deleteTarget)} title={deleteTarget?.title || "Untitled"} busy={busyId === deleteTarget?.id} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} onConfirm={() => { if (deleteTarget) void run(deleteTarget, "delete") }} />
  </div>
}
