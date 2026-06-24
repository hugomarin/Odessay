"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { CollectionCreateDialog } from "@/components/collections/collection-create-dialog"
import { DeskActivityTable } from "@/components/desk/desk-activity-table"
import { BulkActionBar } from "@/components/desk/bulk-action-bar"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal"
import { useWritingSelection } from "@/hooks/useWritingSelection"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import {
  buildCollectionDetailItems,
  buildCollectionOptions,
  buildCollectionSummaries,
  dedupeCollectionIds,
  getUncategorizedWritings,
  getWritingCollectionIds,
  UNCATEGORIZED_COLLECTION_ID,
} from "@/lib/collections/collections"
import { buildCollectionHref } from "@/lib/collections/collection-route"
import {
  createLocalCollection,
  deleteLocalCollection,
  setLocalWritingCollections,
  updateLocalCollection,
} from "@/lib/local-db/collections"
import {
  getLocalDBScope,
  localDB,
  subscribeToLocalDBChanges,
  subscribeToLocalDBScopeChanges,
} from "@/lib/local-db"
import { debounce } from "@/lib/utils/debounce"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import type { DeskActivityGroup, DeskActivityRow, DeskStatusTone } from "@/lib/queries/desk-activity"
import { enqueueWritingDelete, enqueueWritingUpsert } from "@/lib/sync/queue"
import { getSyncService } from "@/lib/sync"
import { getWritingStatusLabel, normalizeWritingStatus } from "@/lib/writings/status"
import type { WritingStatus } from "@/lib/writings/status"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { buildMarkdownDownloadName, serializeWritingToMarkdown } from "@/lib/export/to-markdown"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { downloadBlob } from "@/lib/utils/download"
import { getWorkspaceAssignmentService } from "@/lib/services/workspace-service"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import {
  buildWorkspaceNameLookup,
  readAssignmentSlug,
  type WorkspaceAssignmentMap,
  type WorkspaceAssignmentOption,
} from "@/lib/workspace/assignment"

type CollectionsViewProps = {
  initialExpandedCollectionId?: string | null
}

type RenameTarget = {
  id: string
  title: string
  bodyText: string
}

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000

const buildDateLabel = (updatedAt: Date, now: Date) => {
  if (updatedAt.toDateString() === now.toDateString()) {
    return ""
  }

  if (now.getTime() - updatedAt.getTime() < WEEK_IN_MS) {
    return new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(updatedAt)
  }

  return new Intl.DateTimeFormat("es-MX", { month: "short", day: "numeric" }).format(updatedAt)
}

const buildStatusState = (status: LocalWriting["status"]) => {
  const normalized = normalizeWritingStatus(status)
  return { stateLabel: getWritingStatusLabel(normalized), stateTone: normalized as DeskStatusTone }
}

export function CollectionsView({ initialExpandedCollectionId = null }: CollectionsViewProps) {
  const router = useRouter()
  const [writings, setWritings] = useState<LocalWriting[]>([])
  const [collections, setCollections] = useState<LocalCollection[]>([])
  const [assignments, setAssignments] = useState<LocalWritingCollection[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameWritingTarget, setRenameWritingTarget] = useState<RenameTarget | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [previewWritingId, setPreviewWritingId] = useState<string | null>(null)
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false)
  const { selectedIds, toggleSelection, selectAll, deselectAll, hasSelection, selectedCount } =
    useWritingSelection()
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceAssignmentOption[]>([])
  const [workspaceAssignments, setWorkspaceAssignments] = useState<WorkspaceAssignmentMap>({})
  const [workspaceAvailable, setWorkspaceAvailable] = useState(false)
  const workspaceNameLookup = useMemo(
    () => buildWorkspaceNameLookup(workspaceOptions),
    [workspaceOptions],
  )

  const loadWorkspaceData = useCallback(async () => {
    const service = getWorkspaceAssignmentService()
    setWorkspaceAvailable(service.isAvailable)

    if (!service.isAvailable) {
      setWorkspaceOptions([])
      setWorkspaceAssignments({})
      return
    }

    const [options, assignments] = await Promise.all([
      service.listWorkspaces(),
      service.listAssignments(),
    ])
    setWorkspaceOptions(options)
    setWorkspaceAssignments(assignments)
  }, [])

  const assignWorkspace = useCallback(
    async (writingId: string, slug: string) => {
      await getWorkspaceAssignmentService().assign(writingId, slug)
      await loadWorkspaceData()
    },
    [loadWorkspaceData],
  )

  const unassignWorkspace = useCallback(
    async (writingId: string) => {
      await getWorkspaceAssignmentService().clearAssignment(writingId)
      await loadWorkspaceData()
    },
    [loadWorkspaceData],
  )

  const createWorkspaceAndAssign = useCallback(
    async (writingId: string) => {
      const service = getWorkspaceAssignmentService()
      const created = await service.createWorkspace()
      if (!created) {
        return
      }

      await service.assign(writingId, created.slug)
      await loadWorkspaceData()
    },
    [loadWorkspaceData],
  )

  const loadLocalState = useCallback(async () => {
    const [nextWritings, nextCollections, nextAssignments] = await Promise.all([
      localDB.writings.getAll(),
      localDB.collections.getAll(),
      localDB.writingCollections.listAll(),
    ])

    setWritings(nextWritings)
    setCollections(nextCollections)
    setAssignments(nextAssignments)
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      const syncService = getSyncService()
      await Promise.all([
        syncService.hydrateWritings().catch(() => null),
        syncService.hydrateCollections().catch(() => null),
      ])

      if (!cancelled) {
        await Promise.all([loadLocalState(), loadWorkspaceData()])
      }
    }

    void bootstrap()
    void getSyncService().scheduleFlush()

    const debounced = debounce(() => void loadLocalState(), 100, {
      leading: false,
      trailing: true,
    })
    const unsubscribeChanges = subscribeToLocalDBChanges(debounced)
    const unsubscribeScope = subscribeToLocalDBScopeChanges(() => void bootstrap())

    return () => {
      cancelled = true
      unsubscribeChanges()
      unsubscribeScope()
      debounced.cancel()
    }
  }, [loadLocalState, loadWorkspaceData])

  const collectionOptions = useMemo(() => buildCollectionOptions(collections), [collections])
  const collectionSummaries = useMemo(
    () => buildCollectionSummaries(collections, writings, assignments),
    [assignments, collections, writings],
  )
  const uncategorizedCount = useMemo(
    () => getUncategorizedWritings(writings, assignments).length,
    [assignments, writings],
  )
  const activeCollection = useMemo(
    () =>
      initialExpandedCollectionId && initialExpandedCollectionId !== UNCATEGORIZED_COLLECTION_ID
        ? collections.find((collection) => collection.id === initialExpandedCollectionId) ?? null
        : null,
    [collections, initialExpandedCollectionId],
  )
  const detailItems = useMemo(() => {
    if (!initialExpandedCollectionId) {
      return []
    }

    return buildCollectionDetailItems({
      collectionId: initialExpandedCollectionId,
      writings,
      collections,
      assignments,
    })
  }, [assignments, collections, initialExpandedCollectionId, writings])
  const detailGroups = useMemo<DeskActivityGroup[]>(() => {
    const now = new Date()
    const groups: DeskActivityGroup[] = [
      { label: "Today", rows: [] },
      { label: "This week", rows: [] },
      { label: "Earlier", rows: [] },
    ]

    for (const item of detailItems) {
      const updatedAt = new Date(item.updatedAt)
      const statusState = buildStatusState(item.status)
      const workspaceSlug = readAssignmentSlug(workspaceAssignments, item.id)
      const row = {
        id: item.id,
        title: item.title,
        excerpt: item.excerpt,
        localPath: item.localPath,
        stateLabel: statusState.stateLabel,
        stateTone: statusState.stateTone,
        documentState: item.documentState,
        recipientPreviews: [],
        dateLabel: buildDateLabel(updatedAt, now),
        isNew: false,
        destinationHref: buildWritingRouteHref("/write", { id: item.id, slug: item.slug }),
        workspaceSlug,
        workspaceName: workspaceSlug ? workspaceNameLookup[workspaceSlug] ?? workspaceSlug : null,
      }

      if (updatedAt.toDateString() === now.toDateString()) {
        groups[0].rows.push(row)
        continue
      }

      if (now.getTime() - updatedAt.getTime() < WEEK_IN_MS) {
        groups[1].rows.push(row)
        continue
      }

      groups[2].rows.push(row)
    }

    return groups.filter((group) => group.rows.length > 0)
  }, [detailItems, workspaceAssignments, workspaceNameLookup])

  const previewRows = useMemo<DeskActivityRow[]>(
    () => detailGroups.flatMap((group) => group.rows),
    [detailGroups],
  )
  const previewIndex = useMemo(() => {
    if (!previewWritingId) {
      return null
    }
    const index = previewRows.findIndex((row) => row.id === previewWritingId)
    return index >= 0 ? index : null
  }, [previewRows, previewWritingId])
  const visibleWritingIds = useMemo(() => previewRows.map((row) => row.id), [previewRows])
  const allVisibleSelected =
    visibleWritingIds.length > 0 && visibleWritingIds.every((id) => selectedIds.has(id))

  const createCollection = useCallback(async (name: string) => {
    const ownerId = getLocalDBScope()
    const collection = await createLocalCollection({
      ownerId: ownerId === "anonymous" ? null : ownerId,
      name,
    })

    void getSyncService().scheduleFlush()
    return collection
  }, [])

  const toggleWritingCollection = useCallback(
    async (writingId: string, collectionId: string) => {
      const currentIds = getWritingCollectionIds(writingId, assignments)
      const nextIds = currentIds.includes(collectionId)
        ? currentIds.filter((id) => id !== collectionId)
        : [...currentIds, collectionId]

      await setLocalWritingCollections(writingId, dedupeCollectionIds(nextIds))
      void getSyncService().scheduleFlush()
    },
    [assignments],
  )

  const createCollectionAndAssign = useCallback(
    async (writingId: string, name: string) => {
      const collection = await createCollection(name)
      const currentIds = getWritingCollectionIds(writingId, assignments)
      await setLocalWritingCollections(writingId, dedupeCollectionIds([...currentIds, collection.id]))
      void getSyncService().scheduleFlush()
    },
    [assignments, createCollection],
  )

  const changeWritingStatus = useCallback(async (writingId: string, status: WritingStatus) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted" || writing.status === status) {
      return
    }

    const nowIso = new Date().toISOString()
    await enqueueWritingUpsert({
      ...writing,
      status,
      version: writing.version + 1,
      updated_at: nowIso,
      metadata_updated_at: nowIso,
      local_updated_at: Date.now(),
    })
    void getSyncService().scheduleFlush()
  }, [])

  const changeWritingArtifactType = useCallback(async (writingId: string, artifactType: ArtifactType) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted" || writing.artifact_type === artifactType) {
      return
    }

    const nowIso = new Date().toISOString()
    await enqueueWritingUpsert({
      ...writing,
      artifact_type: artifactType,
      version: writing.version + 1,
      updated_at: nowIso,
      metadata_updated_at: nowIso,
      local_updated_at: Date.now(),
    })
    void getSyncService().scheduleFlush()
  }, [])

  const openWritingPreview = useCallback((writingId: string) => {
    setPreviewWritingId(writingId)
  }, [])

  const openFullWriting = useCallback(
    (writingId: string) => {
      router.push(buildWritingRouteHref("/write", { id: writingId }))
    },
    [router],
  )

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
      if (isDesktopRuntime()) {
        const result = await (await getDocumentService()).renameWriting({
          writingId: writing.id,
          title: trimmedTitle,
          updatedAt: new Date().toISOString(),
        })
        if (result.error) return
        await loadLocalState()
        return
      }

      await enqueueWritingUpsert({
        ...writing,
        title: trimmedTitle,
        version: writing.version + 1,
        updated_at: new Date().toISOString(),
        local_updated_at: Date.now(),
      })
    },
    [loadLocalState],
  )

  const bulkChangeStatus = useCallback(
    async (status: WritingStatus) => {
      for (const writingId of Array.from(selectedIds)) {
        await changeWritingStatus(writingId, status)
      }
    },
    [changeWritingStatus, selectedIds],
  )

  const bulkAddToCollection = useCallback(
    async (collectionId: string) => {
      for (const writingId of Array.from(selectedIds)) {
        const currentIds = getWritingCollectionIds(writingId, assignments)
        if (currentIds.includes(collectionId)) {
          continue
        }
        await setLocalWritingCollections(writingId, dedupeCollectionIds([...currentIds, collectionId]))
      }
      void getSyncService().scheduleFlush()
    },
    [assignments, selectedIds],
  )

  const bulkCreateCollectionAndAdd = useCallback(
    async (name: string) => {
      const collection = await createCollection(name)
      for (const writingId of Array.from(selectedIds)) {
        const currentIds = getWritingCollectionIds(writingId, assignments)
        await setLocalWritingCollections(writingId, dedupeCollectionIds([...currentIds, collection.id]))
      }
      void getSyncService().scheduleFlush()
    },
    [assignments, createCollection, selectedIds],
  )

  const deleteWriting = useCallback(async (writingId: string) => {
    await enqueueWritingDelete(writingId)
  }, [])

  const copyWritingMarkdown = useCallback(async (writingId: string) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return
    }
    const markdown = serializeWritingToMarkdown(writing.body_json).trimEnd()
    await copyTextWithFallback(`${markdown}\n`)
  }, [])

  const downloadWritingMarkdown = useCallback(async (writingId: string) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return
    }
    const markdown = serializeWritingToMarkdown(writing.body_json).trimEnd()
    const blob = new Blob([`${markdown}\n`], { type: "text/markdown;charset=utf-8" })
    downloadBlob(
      blob,
      buildMarkdownDownloadName({ title: writing.title, bodyText: writing.body_text, writingId: writing.id }),
    )
  }, [])

  const openRenameWriting = useCallback(async (writingId: string) => {
    const writing = await localDB.writings.get(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return
    }

    setRenameWritingTarget({
      id: writing.id,
      title: writing.title?.trim() || "Untitled writing",
      bodyText: writing.body_text,
    })
  }, [])

  const saveWritingTitle = useCallback(
    async (nextTitle: string) => {
      if (!renameWritingTarget) {
        return
      }

      const writing = await localDB.writings.get(renameWritingTarget.id)
      if (!writing || writing.sync_status === "deleted") {
        return
      }

      const trimmedTitle = nextTitle.trim() || "Untitled writing"
      if ((writing.title?.trim() || "Untitled writing") === trimmedTitle) {
        return
      }

      if (isDesktopRuntime()) {
        const result = await (await getDocumentService()).renameWriting({
          writingId: writing.id,
          title: trimmedTitle,
          updatedAt: new Date().toISOString(),
        })
        if (result.error) return
        await loadLocalState()
        return
      }

      await enqueueWritingUpsert({
        ...writing,
        title: trimmedTitle,
        version: writing.version + 1,
        updated_at: new Date().toISOString(),
        local_updated_at: Date.now(),
      })
      await loadLocalState()
    },
    [loadLocalState, renameWritingTarget],
  )

  if (!initialExpandedCollectionId) {
    return (
      <section data-page="collections" className="flex min-h-screen flex-col bg-bg">
        <header className="border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))]">
          <div className="flex h-[70px] items-center justify-between gap-4 px-6 md:px-9">
            <div className="flex min-w-0 items-baseline gap-3">
              <p className="shrink-0 text-[24px] font-medium tracking-[-0.03em] text-ink">Collections</p>
              <p className="truncate text-[13px] text-ink-4">Organize writings by theme, project, and context.</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] border-border bg-transparent px-[14px] text-[13px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
            >
              <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} />
              New collection
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-9">
          <div className="mx-auto grid w-full max-w-[1040px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            <Link
              href={buildCollectionHref(UNCATEGORIZED_COLLECTION_ID)}
              className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-dashed border-border bg-transparent px-[14px] py-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-lora text-[18px] font-medium text-ink">Uncategorized</h2>
                <span className="rounded-full border-[0.5px] border-border px-2 py-0.5 text-[11px] text-ink-4">
                  {uncategorizedCount}
                </span>
              </div>
            </Link>

            {collectionSummaries.map((summary) => (
              <Link
                key={summary.id}
                href={buildCollectionHref(summary.id)}
                className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-border bg-sb px-[14px] py-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-lora text-[18px] font-medium text-ink">{summary.name}</h2>
                  <span className="rounded-full border-[0.5px] border-border px-2 py-0.5 text-[11px] text-ink-4">
                    {summary.writingsCount}
                  </span>
                </div>
              </Link>
            ))}

            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex min-h-[96px] flex-col justify-between rounded-[10px] border-[0.5px] border-dashed border-border bg-transparent px-[14px] py-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-sans text-[14px] font-medium text-ink-2">New collection</h2>
                <Plus className="h-4 w-4 text-ink-4" strokeWidth={1.5} />
              </div>
            </button>
          </div>
        </div>

        <CollectionCreateDialog
          open={createOpen}
          pending={isCreating}
          onOpenChange={setCreateOpen}
          onSubmit={async (name) => {
            setIsCreating(true)
            try {
              const collection = await createCollection(name)
              setCreateOpen(false)
              router.push(buildCollectionHref(collection.id))
            } finally {
              setIsCreating(false)
            }
          }}
        />
      </section>
    )
  }

  const isUncategorizedView = initialExpandedCollectionId === UNCATEGORIZED_COLLECTION_ID
  const collectionName = isUncategorizedView ? "Uncategorized" : activeCollection?.name ?? "Collection"

  return (
    <section data-page="collections-detail" className="flex min-h-screen flex-col bg-bg">
      <header className="border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))]">
        <div className="flex min-h-[70px] items-center justify-between gap-4 px-6 py-4 md:px-9">
          <div className="min-w-0">
            <p className="truncate text-[24px] font-medium tracking-[-0.03em] text-ink">{collectionName}</p>
            <div className="pt-1 text-[13px] text-ink-4">
              <Link href="/collections" className="transition-colors hover:text-ink-2">
                Collections
              </Link>
              <span>{isUncategorizedView ? " · Writings without a category." : " · Curated category for related writings."}</span>
            </div>
          </div>

          {activeCollection ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border-[0.5px] border-border px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete "${activeCollection.name}"? Writings will remain available in Desk.`)) {
                    return
                  }

                  void deleteLocalCollection(activeCollection).then(() => {
                    void getSyncService().scheduleFlush()
                    router.push("/collections")
                  })
                }}
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border-[0.5px] border-border px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted hover:text-[hsl(0_72%_42%)]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-10 pt-4 md:px-9">
        <div className="w-full">
          {!isUncategorizedView && !activeCollection ? (
            <p className="font-lora text-[18px] italic text-ink-3">Collection not found.</p>
          ) : detailItems.length === 0 ? (
            <p className="font-lora text-[18px] italic text-ink-3">No writings here yet.</p>
          ) : (
            <>
              {hasSelection && (
                <BulkActionBar
                  selectedCount={selectedCount}
                  visibleCount={visibleWritingIds.length}
                  allVisibleSelected={allVisibleSelected}
                  onSelectAll={() => selectAll(visibleWritingIds)}
                  onDeselectAll={deselectAll}
                  onDelete={() => setIsBulkDeleteOpen(true)}
                  onStatusChange={bulkChangeStatus}
                  collectionOptions={collectionOptions}
                  onAddToCollection={bulkAddToCollection}
                  onCreateCollection={bulkCreateCollectionAndAdd}
                />
              )}
              <div className="border-t-[0.5px] border-border">
              <DeskActivityTable
                groups={detailGroups}
                collectionOptions={collectionOptions}
                collectionIdsByWritingId={Object.fromEntries(
                  detailItems.map((item) => [item.id, getWritingCollectionIds(item.id, assignments)]),
                )}
                onToggleCollection={async (writingId, collectionId) => {
                  await toggleWritingCollection(writingId, collectionId)
                }}
                onCreateCollection={async (writingId, name) => {
                  await createCollectionAndAssign(writingId, name)
                }}
                onStatusChange={changeWritingStatus}
                onArtifactTypeChange={changeWritingArtifactType}
                workspaceOptions={workspaceOptions}
                workspaceAvailable={workspaceAvailable}
                onAssignWorkspace={assignWorkspace}
                onUnassignWorkspace={unassignWorkspace}
                onCreateWorkspace={createWorkspaceAndAssign}
                onRenameWriting={openRenameWriting}
                onPreviewWriting={openWritingPreview}
                onCopyMarkdown={copyWritingMarkdown}
                onDownloadMarkdown={downloadWritingMarkdown}
                onDeleteRequest={deleteWriting}
                selectedIds={selectedIds}
                onToggleSelection={toggleSelection}
                renderExtraMenuItems={
                  isUncategorizedView
                    ? undefined
                    : (row) => (
                        <DropdownMenuItem
                          className="cursor-pointer gap-2 text-[13px]"
                          onClick={() => {
                            void setLocalWritingCollections(
                              row.id,
                              (getWritingCollectionIds(row.id, assignments) ?? []).filter(
                                (collectionId) => collectionId !== initialExpandedCollectionId,
                              ),
                            ).then(() => void getSyncService().scheduleFlush())
                          }}
                        >
                          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
                          Remove from collection
                        </DropdownMenuItem>
                      )
                }
              />
              </div>
            </>
          )}
        </div>
      </div>

      {activeCollection ? (
        <CollectionCreateDialog
          open={renameOpen}
          title="Rename collection"
          description="Update the label name used across Desk, Collections, and the editor."
          confirmLabel="Save"
          initialName={activeCollection.name}
          pending={isRenaming}
          onOpenChange={setRenameOpen}
          onSubmit={async (name) => {
            setIsRenaming(true)
            try {
              await updateLocalCollection(activeCollection, { name })
              void getSyncService().scheduleFlush()
              setRenameOpen(false)
            } finally {
              setIsRenaming(false)
            }
          }}
        />
      ) : null}

      <RenameWritingModal
        open={renameWritingTarget !== null}
        title={renameWritingTarget?.title ?? "Untitled writing"}
        bodyText={renameWritingTarget?.bodyText ?? ""}
        writingId={renameWritingTarget?.id}
        onOpenChange={(open) => {
          if (!open) {
            setRenameWritingTarget(null)
          }
        }}
        onConfirm={(nextTitle) => {
          void saveWritingTitle(nextTitle)
          setRenameWritingTarget(null)
        }}
      />

      <DeleteWritingDialog
        open={isBulkDeleteOpen}
        onOpenChange={setIsBulkDeleteOpen}
        count={selectedCount}
        onConfirm={async () => {
          for (const id of Array.from(selectedIds)) {
            await enqueueWritingDelete(id)
          }
          deselectAll()
        }}
      />

      <WritingPreviewModal
        open={previewWritingId !== null && previewIndex !== null}
        rows={previewRows}
        currentIndex={previewIndex}
        collectionOptions={collectionOptions}
        collectionIdsByWritingId={Object.fromEntries(
          detailItems.map((item) => [item.id, getWritingCollectionIds(item.id, assignments)]),
        )}
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
        onCreateCollection={createCollectionAndAssign}
        onStatusChange={changeWritingStatus}
        onArtifactTypeChange={changeWritingArtifactType}
        workspaceOptions={workspaceOptions}
        workspaceAvailable={workspaceAvailable}
        onAssignWorkspace={assignWorkspace}
        onUnassignWorkspace={unassignWorkspace}
        onCreateWorkspace={createWorkspaceAndAssign}
        onTitleChange={saveWritingTitleById}
        onOpenFullWriting={openFullWriting}
        onExportMarkdown={downloadWritingMarkdown}
      />
    </section>
  )
}
