"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, Upload } from "lucide-react"
import { DeskActivityTable } from "@/components/desk/desk-activity-table"
import { DeskFilterBar, DeskFilterEmptyState } from "@/components/desk/filter-bar"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { DeskHero } from "@/components/desk/desk-hero"
import { DeskViewToggle, type DeskViewMode } from "@/components/desk/desk-view-toggle"
import { SharedWithMeList } from "@/components/desk/shared-with-me-list"
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import { useDeskFilters } from "@/hooks/useDeskFilters"
import { useWritingSelection } from "@/hooks/useWritingSelection"
import { BulkActionBar } from "@/components/desk/bulk-action-bar"
import {
  buildCollectionOptions,
  dedupeCollectionIds,
  getWritingCollectionIds,
} from "@/lib/collections/collections"
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap"
import { createLocalCollection, setLocalWritingCollections } from "@/lib/local-db/collections"
import {
  getLocalDBScope,
  localDB,
  subscribeToLocalDBChanges,
  subscribeToLocalDBScopeChanges,
} from "@/lib/local-db"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import {
  buildDeskActivitySummary,
  type DeskActivitySummary,
} from "@/lib/queries/desk-activity"
import type { SharedWritingListItem } from "@/lib/sharing/writing-shares"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"
import { enqueueWritingDelete, enqueueWritingUpsert } from "@/lib/sync/queue"
import { getSyncWorker } from "@/lib/sync/worker"
import { ImportWritingDialog } from "@/components/desk/import-writing-dialog"


type ApiEnvelope<T> = {
  data: T | null
  error: { code: string; message: string } | null
}

type RecipientPreview = {
  username: string
  displayName: string
}

type RenameTarget = {
  id: string
  title: string
  bodyText: string
}

const EMPTY_SUMMARY: DeskActivitySummary = {
  heroDrafts: [],
  groups: [],
  counts: {
    all: 0,
    correspondence: 0,
    "with-responses": 0,
    received: 0,
  },
  total: 0,
}

type SharedApiEnvelope<T> = {
  data: T | null
  error: { code: string; message: string } | null
}

export default function DeskPage() {
  const [summary, setSummary] = useState<DeskActivitySummary>(EMPTY_SUMMARY)
  const [isLoading, setIsLoading] = useState(true)
  const [sharedItems, setSharedItems] = useState<SharedWritingListItem[]>([])
  const [isSharedLoading, setIsSharedLoading] = useState(false)
  const [sharedError, setSharedError] = useState<string | null>(null)
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [writingCollections, setWritingCollections] = useState<LocalWritingCollection[]>([])
  const [rawWritings, setRawWritings] = useState<LocalWriting[]>([])
  const [activeView, setActiveView] = useState<DeskViewMode>("mine")
  const [recipientPreviewsByWritingId, setRecipientPreviewsByWritingId] = useState<
    Record<string, RecipientPreview[]>
  >({})
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [previewWritingId, setPreviewWritingId] = useState<string | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const recipientPreviewsRef = useRef(recipientPreviewsByWritingId)
  const hasHydratedRemoteRef = useRef(false)
  const hasLoadedSharedRef = useRef(false)

  recipientPreviewsRef.current = recipientPreviewsByWritingId

  const {
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    setSearchQuery,
    toggleCollection,
    toggleStatus,
    clearFilters,
    hasActiveFilters,
    activeFilterCount,
  } = useDeskFilters()

  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    hasSelection,
    selectedCount,
  } = useWritingSelection()

  const updateActiveView = useCallback((nextView: DeskViewMode) => {
    setActiveView(nextView)
  }, [])

  const loadRecipientPreviews = useCallback(
    async (writingIds: string[]) => {
      if (writingIds.length === 0) {
        return {}
      }

      try {
        const response = await fetch(
          `/api/writings/shares?ids=${encodeURIComponent(writingIds.join(","))}`,
          { cache: "no-store" },
        )
        const payload = (await response.json()) as ApiEnvelope<
          Record<string, RecipientPreview[]>
        >

        if (!response.ok || payload.error || !payload.data) {
          return Object.fromEntries(
            writingIds.map((id) => [id, [] as RecipientPreview[]]),
          )
        }

        // Ensure every requested ID has an entry (backend returns [] for non-owned or missing)
        const result: Record<string, RecipientPreview[]> = {}
        for (const id of writingIds) {
          result[id] = payload.data[id] ?? []
        }
        return result
      } catch {
        return Object.fromEntries(
          writingIds.map((id) => [id, [] as RecipientPreview[]]),
        )
      }
    },
    [],
  )

  const syncRemoteWritings = useCallback(async () => {
    try {
      await Promise.all([
        hydrateLocalWritingsFromRemote(),
        hydrateLocalCollectionsFromRemote(),
      ])
      return true
    } catch (error) {
      console.error("[desk:hydrate]", error)
      return false
    }
  }, [])

  const hydrateRemoteIfNeeded = useCallback(
    async (force = false) => {
      if (!force && hasHydratedRemoteRef.current) {
        return
      }

      const hydrated = await syncRemoteWritings()
      hasHydratedRemoteRef.current = hydrated
    },
    [syncRemoteWritings],
  )

  const loadDeskActivity = useCallback(async () => {
    const localWritings = await localDB.writings.getAll()
    const [nextCollections, nextAssignments] = await Promise.all([
      localDB.collections.getAll(),
      localDB.writingCollections.listAll(),
    ])
    const localScope = getLocalDBScope()

    setRawWritings(localWritings)
    setSummary(
      buildDeskActivitySummary(localWritings, {
        filter: "all",
        userId: localScope === "anonymous" ? null : localScope,
        recipientPreviewsByWritingId: recipientPreviewsRef.current,
      }),
    )
    setCollections(nextCollections)
    setWritingCollections(nextAssignments)
  }, [])

  const loadRecipientPreviewsAsync = useCallback(async () => {
    const localWritings = await localDB.writings.getAll()
    const sharedWritingIds = localWritings
      .filter((writing) => writing.visibility === "shared" && writing.sync_status !== "deleted")
      .map((writing) => writing.id)

    if (sharedWritingIds.length === 0) {
      return
    }

    const previews = await loadRecipientPreviews(sharedWritingIds)
    setRecipientPreviewsByWritingId((prev) => ({ ...prev, ...previews }))
  }, [loadRecipientPreviews])

  const loadSharedWritings = useCallback(
    async (force = false) => {
      if (!force && hasLoadedSharedRef.current) {
        return
      }

      setIsSharedLoading(true)
      setSharedError(null)

      try {
        const response = await fetch("/api/shared/writings", {
          cache: "no-store",
        })
        const payload = (await response.json()) as SharedApiEnvelope<SharedWritingListItem[]>

        if (!response.ok || payload.error || !payload.data) {
          throw new Error(payload.error?.message ?? "Failed to load shared writings.")
        }

        setSharedItems(payload.data)
        hasLoadedSharedRef.current = true
      } catch (error) {
        setSharedItems([])
        setSharedError(error instanceof Error ? error.message : "Failed to load shared writings.")
      } finally {
        setIsSharedLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    clearFilters()
    deselectAll()
  }, [activeView, clearFilters, deselectAll])

  useEffect(() => {
    if (activeView !== "mine") {
      return
    }

    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      // 1. Render local data immediately — don't wait for remote
      await loadDeskActivity()
      void loadRecipientPreviewsAsync()
      if (!cancelled) {
        setIsLoading(false)
      }
      // 2. Hydrate from Supabase in background
      void hydrateRemoteIfNeeded().then(() => {
        if (cancelled) {
          return
        }

        void loadDeskActivity()
        void loadRecipientPreviewsAsync()
      })
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync])

  useEffect(() => {
    if (activeView !== "shared") {
      return
    }

    void loadSharedWritings()
  }, [activeView, loadSharedWritings])

  useEffect(() => {
    if (activeView === "mine") {
      void loadDeskActivity()
    }
  }, [recipientPreviewsByWritingId, activeView, loadDeskActivity])

  useEffect(() => {
    return subscribeToLocalDBScopeChanges(() => {
      hasHydratedRemoteRef.current = false
      if (activeView === "mine") {
        void hydrateRemoteIfNeeded(true).then(() => {
          void loadDeskActivity()
          void loadRecipientPreviewsAsync()
        })
      }
    })
  }, [activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync])

  useEffect(() => {
    return subscribeToLocalDBChanges(() => {
      if (activeView === "mine") {
        void loadDeskActivity()
        void loadRecipientPreviewsAsync()
      }
    })
  }, [activeView, loadDeskActivity, loadRecipientPreviewsAsync])

  useEffect(() => {
    const handleRefresh = () => {
      if (activeView === "mine") {
        void hydrateRemoteIfNeeded(true).then(() => {
          void loadDeskActivity()
          void loadRecipientPreviewsAsync()
        })
        return
      }

      void loadSharedWritings(true)
    }

    window.addEventListener("focus", handleRefresh)
    window.addEventListener("online", handleRefresh)

    return () => {
      window.removeEventListener("focus", handleRefresh)
      window.removeEventListener("online", handleRefresh)
    }
  }, [activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync, loadSharedWritings])
  const collectionOptions = useMemo(() => buildCollectionOptions(collections), [collections])
  const collectionIdsByWritingId = useMemo(() => {
    const grouped = new Map<string, string[]>()

    for (const assignment of writingCollections) {
      const nextIds = grouped.get(assignment.writing_id) ?? []
      nextIds.push(assignment.collection_id)
      grouped.set(assignment.writing_id, nextIds)
    }

    return Object.fromEntries(grouped)
  }, [writingCollections])

  const filteredSummary = useMemo(() => {
    if (!hasActiveFilters || rawWritings.length === 0) {
      return summary
    }

    const localScope = getLocalDBScope()
    return buildDeskActivitySummary(rawWritings, {
      filter: "all",
      userId: localScope === "anonymous" ? null : localScope,
      recipientPreviewsByWritingId,
      clientFilter: {
        searchQuery,
        selectedCollectionIds,
        selectedStatuses,
        assignments: writingCollections,
      },
    })
  }, [
    hasActiveFilters,
    rawWritings,
    summary,
    recipientPreviewsByWritingId,
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    writingCollections,
  ])

  const visibleWritingIds = useMemo(() => {
    return filteredSummary.groups.flatMap((group) => group.rows.map((row) => row.id))
  }, [filteredSummary])

  const previewRows = useMemo(() => {
    return filteredSummary.groups.flatMap((group) => group.rows)
  }, [filteredSummary])

  const previewIndex = useMemo(() => {
    if (!previewWritingId) {
      return null
    }

    const nextIndex = previewRows.findIndex((row) => row.id === previewWritingId)
    return nextIndex >= 0 ? nextIndex : null
  }, [previewRows, previewWritingId])

  const allVisibleSelected =
    visibleWritingIds.length > 0 && visibleWritingIds.every((id) => selectedIds.has(id))

  const viewCounts = useMemo(
    () => ({
      mine: summary.total,
      shared: sharedItems.length,
    }),
    [sharedItems.length, summary.total],
  )

  useEffect(() => {
    if (previewWritingId && previewIndex === null) {
      setPreviewWritingId(null)
    }
  }, [previewIndex, previewWritingId])

  const openRenameWriting = useCallback(async (writingId: string) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return
    }

    setRenameTarget({
      id: writing.id,
      title: writing.title?.trim() || "Untitled writing",
      bodyText: writing.body_text,
    })
  }, [])

  const openWritingPreview = useCallback(
    (writingId: string) => {
      if (previewRows.some((row) => row.id === writingId)) {
        setPreviewWritingId(writingId)
      }
    },
    [previewRows],
  )

  const toggleWritingCollection = useCallback(
    async (writingId: string, collectionId: string) => {
      const currentIds = getWritingCollectionIds(writingId, writingCollections)
      const nextIds = currentIds.includes(collectionId)
        ? currentIds.filter((id) => id !== collectionId)
        : [...currentIds, collectionId]

      await setLocalWritingCollections(writingId, dedupeCollectionIds(nextIds))
      getSyncWorker().schedule(0)
    },
    [writingCollections],
  )

  const createWritingCollection = useCallback(
    async (writingId: string, name: string) => {
      const ownerId = getLocalDBScope()
      const collection = await createLocalCollection({
        ownerId: ownerId === "anonymous" ? null : ownerId,
        name,
      })
      const currentIds = getWritingCollectionIds(writingId, writingCollections)
      await setLocalWritingCollections(writingId, dedupeCollectionIds([...currentIds, collection.id]))
      getSyncWorker().schedule(0)
    },
    [writingCollections],
  )

  const changeWritingStatus = useCallback(async (writingId: string, status: LocalWriting["status"]) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return
    }
    if (writing.status === status) {
      return
    }

    const updatedWriting: LocalWriting = {
      ...writing,
      status,
      version: writing.version + 1,
      updated_at: new Date().toISOString(),
      local_updated_at: Date.now(),
    }

    await enqueueWritingUpsert(updatedWriting)
  }, [])

  const saveWritingTitleById = useCallback(
    async (writingId: string, nextTitle: string) => {
      const writing = await localDB.writings.get(writingId)
      if (!writing || writing.sync_status === "deleted") {
        return
      }

      const trimmedTitle = nextTitle.trim() || "Untitled writing"
      if ((writing.title?.trim() || "Untitled writing") === trimmedTitle) {
        return
      }

      await enqueueWritingUpsert({
        ...writing,
        title: trimmedTitle,
        version: writing.version + 1,
        updated_at: new Date().toISOString(),
        local_updated_at: Date.now(),
      })
      await loadDeskActivity()
      void loadRecipientPreviewsAsync()
    },
    [loadDeskActivity, loadRecipientPreviewsAsync],
  )

  const saveWritingTitle = useCallback(
    async (nextTitle: string) => {
      if (!renameTarget) {
        return
      }

      await saveWritingTitleById(renameTarget.id, nextTitle)
    },
    [renameTarget, saveWritingTitleById],
  )

  return (
    <section id="desk" data-page="desk" className="Desk flex min-h-screen flex-col bg-bg">
      <div
        id="desk-topbar"
        data-section="desk-topbar"
        data-testid="desk-topbar"
        className="DeskTopbar flex h-[70px] items-center justify-between gap-4 border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))] px-5 sm:px-9"
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <p className="shrink-0 text-[24px] font-medium tracking-[-0.03em] text-ink">Desk</p>
          <p className="truncate text-[13px] text-ink-4">Writing activity, shared drafts, and collection context.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] border-border bg-transparent px-[14px] text-[13px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
          >
            <Upload className="h-[14px] w-[14px]" strokeWidth={1.5} />
            Import
          </button>
          <Link
            href="/write"
            className="inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] border-border bg-transparent px-[14px] text-[13px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
          >
            <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} />
            New writing
          </Link>
        </div>
      </div>

      {activeView === "mine" ? (
        <>
          <DeskHero drafts={summary.heroDrafts} />

          <div className="flex flex-wrap items-center justify-between gap-4 border-b-[0.5px] border-border px-5 py-[14px] sm:px-9">
            <DeskViewToggle activeView={activeView} counts={viewCounts} onViewChange={updateActiveView} />
            <div className="min-w-[280px] flex-1">
              <DeskFilterBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedCollectionIds={selectedCollectionIds}
                onToggleCollection={toggleCollection}
                selectedStatuses={selectedStatuses}
                onToggleStatus={toggleStatus}
                collectionOptions={collectionOptions}
                activeFilterCount={activeFilterCount}
                hasActiveFilters={hasActiveFilters}
                filteredCount={filteredSummary.total}
                totalCount={summary.total}
              />
            </div>
          </div>

          {hasSelection && (
            <BulkActionBar
              selectedCount={selectedCount}
              visibleCount={visibleWritingIds.length}
              allVisibleSelected={allVisibleSelected}
              onSelectAll={() => selectAll(visibleWritingIds)}
              onDeselectAll={deselectAll}
              onDelete={() => setIsBulkDeleteOpen(true)}
              onStatusChange={async (status) => {
                for (const writingId of Array.from(selectedIds)) {
                  await changeWritingStatus(writingId, status)
                }
              }}
              collectionOptions={collectionOptions}
              onAddToCollection={async (collectionId) => {
                for (const writingId of Array.from(selectedIds)) {
                  const currentIds = getWritingCollectionIds(writingId, writingCollections)
                  if (currentIds.includes(collectionId)) continue
                  await setLocalWritingCollections(
                    writingId,
                    dedupeCollectionIds([...currentIds, collectionId]),
                  )
                }
                getSyncWorker().schedule(0)
              }}
              onCreateCollection={async (name) => {
                const ownerId = getLocalDBScope()
                const collection = await createLocalCollection({
                  ownerId: ownerId === "anonymous" ? null : ownerId,
                  name,
                })
                for (const writingId of Array.from(selectedIds)) {
                  const currentIds = getWritingCollectionIds(writingId, writingCollections)
                  await setLocalWritingCollections(
                    writingId,
                    dedupeCollectionIds([...currentIds, collection.id]),
                  )
                }
                getSyncWorker().schedule(0)
              }}
            />
          )}

          {hasActiveFilters && filteredSummary.groups.length === 0 && !isLoading ? (
            <DeskFilterEmptyState onClear={clearFilters} />
          ) : (
            <DeskActivityTable
              groups={filteredSummary.groups}
              isLoading={isLoading}
              collectionOptions={collectionOptions}
              collectionIdsByWritingId={collectionIdsByWritingId}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              hasSelection={hasSelection}
              onToggleCollection={toggleWritingCollection}
              onCreateCollection={createWritingCollection}
              onStatusChange={changeWritingStatus}
              onRenameWriting={openRenameWriting}
              onPreviewWriting={openWritingPreview}
              onDeleteRequest={async (id) => {
                await enqueueWritingDelete(id)
                await loadDeskActivity()
                void loadRecipientPreviewsAsync()
              }}
            />
          )}

          <DeleteWritingDialog
            open={isBulkDeleteOpen}
            onOpenChange={setIsBulkDeleteOpen}
            count={selectedCount}
            onConfirm={async () => {
              for (const id of Array.from(selectedIds)) {
                await enqueueWritingDelete(id)
              }
              deselectAll()
              await loadDeskActivity()
              void loadRecipientPreviewsAsync()
            }}
          />

          <RenameWritingModal
            open={renameTarget !== null}
            title={renameTarget?.title ?? "Untitled writing"}
            bodyText={renameTarget?.bodyText ?? ""}
            onOpenChange={(open) => {
              if (!open) {
                setRenameTarget(null)
              }
            }}
            onConfirm={(nextTitle) => {
              void saveWritingTitle(nextTitle)
              setRenameTarget(null)
            }}
          />

          <WritingPreviewModal
            open={previewWritingId !== null && previewIndex !== null}
            rows={previewRows}
            currentIndex={previewIndex}
            collectionOptions={collectionOptions}
            collectionIdsByWritingId={collectionIdsByWritingId}
            onOpenChange={(open) => {
              if (!open) {
                setPreviewWritingId(null)
              }
            }}
            onIndexChange={(index) => {
              const nextRow = previewRows[index]
              if (nextRow) {
                setPreviewWritingId(nextRow.id)
              }
            }}
            onToggleCollection={toggleWritingCollection}
            onCreateCollection={createWritingCollection}
            onStatusChange={changeWritingStatus}
            onTitleChange={saveWritingTitleById}
          />
        </>
      ) : (
        <>
          <div className="border-b-[0.5px] border-border px-5 py-[14px] sm:px-9">
            <DeskViewToggle activeView={activeView} counts={viewCounts} onViewChange={updateActiveView} />
          </div>
          <SharedWithMeList items={sharedItems} isLoading={isSharedLoading} error={sharedError} />
          
        </>
      )}
      <ImportWritingDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
    </section>
  )
}
