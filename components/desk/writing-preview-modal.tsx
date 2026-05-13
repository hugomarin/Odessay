"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Check, FolderPlus } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { WritingContentFrame } from "@/components/reading/writing-content-frame"
import { useWritingPreviewCache, type CachedWritingPreview } from "@/hooks/useWritingPreviewCache"
import type { CollectionOption } from "@/lib/collections/collections"
import type { DeskActivityRow, DeskStatusTone } from "@/lib/queries/desk-activity"
import { getWritingStatusLabel, type WritingStatus, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

type WritingPreviewModalProps = {
  open: boolean
  rows: DeskActivityRow[]
  currentIndex: number | null
  collectionOptions: CollectionOption[]
  collectionIdsByWritingId: Record<string, string[]>
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
  onToggleCollection: (writingId: string, collectionId: string) => Promise<void>
  onCreateCollection: (writingId: string, name: string) => Promise<void>
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>
}

const STATUS_PILL_STYLES: Record<DeskStatusTone, string> = {
  new: "bg-[hsl(220,40%,94%)] text-[hsl(220,45%,42%)]",
  exploring: "bg-[hsl(35,50%,92%)] text-[hsl(35,50%,32%)]",
  draft: "bg-muted text-ink-4",
  done: "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,30%)]",
}

const PREFETCH_OFFSETS = [1, -1, 2, -2]

export function WritingPreviewModal({
  open,
  rows,
  currentIndex,
  collectionOptions,
  collectionIdsByWritingId,
  onOpenChange,
  onIndexChange,
  onToggleCollection,
  onCreateCollection,
  onStatusChange,
}: WritingPreviewModalProps) {
  const { fetchPreview, prefetchPreview, retainOnly, clear } = useWritingPreviewCache()
  const [preview, setPreview] = useState<CachedWritingPreview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const loadIdRef = useRef(0)

  const row = currentIndex === null ? null : rows[currentIndex] ?? null
  const canGoPrevious = currentIndex !== null && currentIndex > 0
  const canGoNext = currentIndex !== null && currentIndex < rows.length - 1

  const selectedCollectionIds = useMemo(
    () => (row ? collectionIdsByWritingId[row.id] ?? [] : []),
    [collectionIdsByWritingId, row],
  )
  const selectedCollections = useMemo(() => {
    const collectionOptionById = new Map(collectionOptions.map((option) => [option.id, option]))
    return selectedCollectionIds
      .map((collectionId) => collectionOptionById.get(collectionId))
      .filter((collection): collection is CollectionOption => Boolean(collection))
  }, [collectionOptions, selectedCollectionIds])

  const navigateBy = useCallback(
    (delta: number) => {
      if (currentIndex === null) {
        return
      }

      const nextIndex = currentIndex + delta
      if (nextIndex < 0 || nextIndex >= rows.length) {
        return
      }

      onIndexChange(nextIndex)
    },
    [currentIndex, onIndexChange, rows.length],
  )

  useEffect(() => {
    if (!open || !row || currentIndex === null) {
      return
    }

    let cancelled = false
    const loadId = loadIdRef.current + 1
    loadIdRef.current = loadId

    setIsLoading(true)
    void fetchPreview(row.id).then((nextPreview) => {
      if (cancelled || loadIdRef.current !== loadId) {
        return
      }

      setPreview(nextPreview)
      setIsLoading(false)
    })

    const windowIds = [row.id]
    for (const offset of PREFETCH_OFFSETS) {
      const nextRow = rows[currentIndex + offset]
      if (!nextRow) {
        continue
      }

      windowIds.push(nextRow.id)
      prefetchPreview(nextRow.id)
    }
    retainOnly(windowIds)

    return () => {
      cancelled = true
    }
  }, [currentIndex, fetchPreview, open, prefetchPreview, retainOnly, row, rows])

  useEffect(() => {
    if (open) {
      return
    }

    setPreview(null)
    setIsLoading(false)
    clear()
  }, [clear, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        navigateBy(-1)
      }

      if (event.key === "ArrowRight") {
        event.preventDefault()
        navigateBy(1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [navigateBy, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-h-[88vh] max-w-[1040px] overflow-hidden p-0">
        <DialogTitle className="sr-only">{preview?.title ?? row?.title ?? "Writing preview"}</DialogTitle>
        <DialogDescription className="sr-only">Read-only writing preview from Desk.</DialogDescription>

        <div className="flex h-[min(760px,88vh)] min-h-0 flex-col bg-bg">
          <div className="flex h-[50px] shrink-0 items-center justify-between border-b-[0.5px] border-border bg-sb px-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigateBy(-1)}
                disabled={!canGoPrevious}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                aria-label="Previous writing"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => navigateBy(1)}
                disabled={!canGoNext}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                aria-label="Next writing"
              >
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
              {currentIndex !== null ? (
                <span className="pl-2 text-[12px] text-ink-4">
                  {currentIndex + 1} of {rows.length}
                </span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-8 items-center rounded-[8px] border-[0.5px] border-border px-3 text-[12px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
            >
              Close
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_248px]">
            <main className="min-h-0 overflow-y-auto">
              <div className="border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))] px-8 py-7">
                <p className="font-lora text-[30px] font-medium leading-[1.2] text-ink">
                  {preview?.title ?? row?.title ?? "Untitled writing"}
                </p>
              </div>

              {isLoading ? (
                <div className="space-y-3 p-8">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                </div>
              ) : preview ? (
                <WritingContentFrame
                  title={preview.title}
                  bodyHtml={preview.bodyHtml}
                  bodyId="desk-preview-body"
                  bodyTestId="desk-preview-body"
                  showTitle={false}
                />
              ) : (
                <div className="p-8">
                  <p className="font-lora text-[15px] italic text-ink-3">This writing is unavailable.</p>
                </div>
              )}
            </main>

            <aside className="flex min-h-0 flex-col border-l-[0.5px] border-border bg-sb">
              <div className="space-y-7 overflow-y-auto px-5 py-6">
                <section className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</p>
                  {row ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center rounded-md px-[10px] py-[5px] text-[12px] font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
                            STATUS_PILL_STYLES[row.stateTone],
                          )}
                        >
                          {row.stateLabel}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[140px]">
                        {WRITING_STATUS_VALUES.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            className="flex cursor-pointer items-center justify-between gap-3 text-[13px]"
                            onClick={() => {
                              void onStatusChange?.(row.id, status)
                            }}
                          >
                            <span>{getWritingStatusLabel(status)}</span>
                            {row.stateTone === status ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </section>

                <section className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedCollections.length > 0 ? (
                      selectedCollections.map((collection) => (
                        <span
                          key={collection.id}
                          className="inline-flex min-h-[24px] items-center rounded-[9px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-[9px] text-[11px] font-medium tracking-[0.01em] text-[hsl(28_22%_22%)]"
                        >
                          {collection.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[12px] text-ink-4">No collections</span>
                    )}
                  </div>
                  {row ? (
                    <CollectionAssignmentMenu
                      collections={collectionOptions}
                      selectedIds={selectedCollectionIds}
                      onToggleCollection={(collectionId) => onToggleCollection(row.id, collectionId)}
                      onCreateCollection={(name) => onCreateCollection(row.id, name)}
                      title="Add to collections"
                      description="Choose labels for this writing."
                      trigger={
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-border bg-transparent px-3 text-[12px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                        >
                          <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                          Add
                        </button>
                      }
                    />
                  ) : null}
                </section>
              </div>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
