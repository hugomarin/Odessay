"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, ChevronDown, Tag, X } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { WritingContentFrame } from "@/components/reading/writing-content-frame"
import { useWritingPreviewCache, type CachedWritingPreview } from "@/hooks/useWritingPreviewCache"
import type { CollectionOption } from "@/lib/collections/collections"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"
import { getWritingStatusLabel, type WritingStatus, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { WritingStatusIcon } from "@/components/desk/writing-status-icon"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
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
  onTitleChange?: (writingId: string, title: string) => Promise<void>
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
  onTitleChange,
}: WritingPreviewModalProps) {
  const { fetchPreview, getCachedPreview, prefetchPreview, retainOnly, clear, updatePreviewTitle } = useWritingPreviewCache()
  const [preview, setPreview] = useState<CachedWritingPreview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [statusOpen, setStatusOpen] = useState(false)
  const loadIdRef = useRef(0)
  const titleDraftRef = useRef("")
  const { settings } = useUserSettingsContext()
  const enabledStatuses = WRITING_STATUS_VALUES.filter((s) => !settings.disabledStatuses.includes(s))
  const titleEditingRef = useRef(false)
  const titleWritingIdRef = useRef<string | null>(null)

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

  const commitTitle = useCallback(async () => {
    if (!row || !onTitleChange) {
      return
    }

    const nextTitle = titleDraft.trim() || "Untitled writing"
    const currentTitle = preview?.title ?? row.title
    if (nextTitle === currentTitle) {
      setTitleDraft(currentTitle)
      titleDraftRef.current = currentTitle
      return
    }

    await onTitleChange(row.id, nextTitle)
    updatePreviewTitle(row.id, nextTitle)
    setPreview((current) => (current && current.id === row.id ? { ...current, title: nextTitle } : current))
    setTitleDraft(nextTitle)
    titleDraftRef.current = nextTitle
  }, [onTitleChange, preview?.title, row, titleDraft, updatePreviewTitle])

  useEffect(() => {
    if (!open || !row || currentIndex === null) {
      return
    }

    let cancelled = false
    const loadId = loadIdRef.current + 1
    loadIdRef.current = loadId
    const isNewWriting = titleWritingIdRef.current !== row.id
    if (isNewWriting) {
      titleWritingIdRef.current = row.id
      titleEditingRef.current = false
    }

    const cachedPreview = getCachedPreview(row.id)
    if (cachedPreview) {
      setPreview(cachedPreview)
      if (isNewWriting || !titleEditingRef.current) {
        setTitleDraft(cachedPreview.title)
        titleDraftRef.current = cachedPreview.title
      }
      setIsLoading(false)
    } else {
      if (isNewWriting || !titleEditingRef.current) {
        setTitleDraft(row.title)
        titleDraftRef.current = row.title
      }
      setIsLoading(true)
    }

    void fetchPreview(row.id).then((nextPreview) => {
      if (cancelled || loadIdRef.current !== loadId) {
        return
      }

      setPreview(nextPreview)
      if (!titleEditingRef.current) {
        const nextTitle = nextPreview?.title ?? row.title
        setTitleDraft(nextTitle)
        titleDraftRef.current = nextTitle
      }
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
  }, [currentIndex, fetchPreview, getCachedPreview, open, prefetchPreview, retainOnly, row, rows])

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

            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">Preview</span>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_292px]">
            <main className="min-h-0 overflow-y-auto">
              <div className="border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))] px-8 py-7">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">Title</p>
                <input
                  value={titleDraft}
                  onFocus={() => {
                    titleEditingRef.current = true
                  }}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setTitleDraft(nextValue)
                    titleDraftRef.current = nextValue
                    titleEditingRef.current = true
                  }}
                  onBlur={() => {
                    titleEditingRef.current = false
                    void commitTitle()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                  className="w-full bg-transparent text-[22px] font-medium leading-[1.25] text-ink outline-none placeholder:text-ink-4 focus-visible:ring-0"
                  placeholder="Untitled writing"
                  aria-label="Writing title"
                />
              </div>

              {isLoading && !preview ? (
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
              <div className="flex h-[50px] shrink-0 items-center justify-between border-b-[0.5px] border-border px-5">
                <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-4">Properties</p>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  aria-label="Close preview"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>

              <div className="space-y-7 overflow-y-auto px-5 py-6">
                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</p>
                  {row ? (
                    <Popover open={statusOpen} onOpenChange={setStatusOpen}>
                      <PopoverTrigger asChild>
                        <div>
                          <PropertiesDropdownTrigger
                            open={statusOpen}
                            icon={<WritingStatusIcon status={row.stateTone} />}
                            label={row.stateLabel}
                          />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[236px] p-[5px]">
                        {enabledStatuses.map((status) => (
                          <PropertiesPopoverItem
                            key={status}
                            selected={row.stateTone === status}
                            icon={<WritingStatusIcon status={status} />}
                            label={getWritingStatusLabel(status)}
                            onSelect={() => {
                              void onStatusChange?.(row.id, status)
                              setStatusOpen(false)
                            }}
                          />
                        ))}
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
                  {row ? (
                    <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
                      <div className="px-3 py-[11px]">
                        <CollectionAssignmentMenu
                          collections={collectionOptions}
                          selectedIds={selectedCollectionIds}
                          align="start"
                          onToggleCollection={(collectionId) => onToggleCollection(row.id, collectionId)}
                          onCreateCollection={(name) => onCreateCollection(row.id, name)}
                          title="Add to collections"
                          description="Choose labels for this writing."
                          trigger={
                            <button
                              type="button"
                              className="flex h-8 w-full items-center gap-2 rounded-[8px] text-left text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                            >
                              <Tag className="h-[13px] w-[13px] text-ink-3" strokeWidth={1.5} />
                              Add to collections
                            </button>
                          }
                        />
                      </div>

                      <div className="border-t-[0.5px] border-border px-3 py-[11px]">
                        {selectedCollections.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedCollections.map((collection) => (
                              <span
                                key={collection.id}
                                className="inline-flex min-h-[24px] items-center rounded-[9px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-[9px] text-[11px] font-medium tracking-[0.01em] text-[hsl(28_22%_22%)]"
                              >
                                {collection.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[12px] text-ink-4">No collections assigned yet.</p>
                        )}
                      </div>
                    </div>
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

function PropertiesDropdownTrigger({
  open,
  icon,
  label,
}: {
  open: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-10 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted",
        open && "border-ink-3 bg-sb",
      )}
    >
      <span className="flex shrink-0 items-center text-ink-3">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown
        className={cn("h-3 w-3 shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
        strokeWidth={1.5}
      />
    </button>
  )
}

function PropertiesPopoverItem({
  selected = false,
  icon,
  label,
  onSelect,
}: {
  selected?: boolean
  icon: React.ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[12px] text-ink-2 transition-colors hover:bg-muted",
        selected && "font-medium text-ink",
      )}
    >
      <span className={cn("flex shrink-0 items-center text-ink-4", selected && "text-ink-2")}>{icon}</span>
      <span>{label}</span>
      {selected ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ink" /> : null}
    </button>
  )
}
