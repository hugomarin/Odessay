"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DeskArtifactList } from "@/components/desk/desk-artifact-list"
import {
  NoArtifactsEmptyState,
  STARTER_DOCUMENTS_UNAVAILABLE,
} from "@/components/shared/view-empty-states"
import { DeskFilterBar, DeskFilterEmptyState } from "@/components/desk/filter-bar"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { DeskHeader } from "@/components/desk/desk-header"
import { ViewTitlebarSpacer } from "@/components/navigation/view-titlebar-spacer"
import { DeskViewToggle, type DeskViewMode } from "@/components/desk/desk-view-toggle"
import { SharedWithMeList } from "@/components/desk/shared-with-me-list"
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import { useDeskFilters } from "@/hooks/useDeskFilters"
import { useWritingSelection } from "@/hooks/useWritingSelection"
import { BulkActionBar } from "@/components/desk/bulk-action-bar"
import { buildCollectionOptions } from "@/lib/collections/collections"
import { debounce } from "@/lib/utils/debounce"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import {
  buildDeskActivitySummary,
  type DeskActivitySummary,
} from "@/lib/queries/desk-activity"
import {
  getLocalDBScope,
  getWritingForEdit,
  loadDeskCatalogData,
  loadSharedWritingIds,
  subscribeToCollectionChanges,
  subscribeToLocalDBScopeChanges,
} from "@/lib/queries/desk-catalog-source"
import {
  bulkAddToCollection,
  bulkChangeArtifactType,
  bulkChangeStatus,
  bulkCreateCollection,
  bulkDelete,
  changeWritingArtifactType,
  changeWritingStatus,
  createAndAssignCollection,
  deleteWriting,
  renameWriting,
  toggleWritingCollection as toggleWritingCollectionMutation,
} from "@/lib/queries/writing-mutations"
import { createSharingService } from "@/lib/services/sharing-service-factory"
import { type RecipientPreview } from "@/lib/services/web-sharing-service"
import type { SharedWritingListItem } from "@/lib/sharing/writing-shares"
import { getSyncService } from "@/lib/sync"
import { invalidateWebWritingsHydrationFreshness } from "@/lib/sync/remote-bootstrap"
import { invalidateWebCollectionsHydrationFreshness } from "@/lib/collections/remote-bootstrap"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { getWorkspaceAssignmentService } from "@/lib/services/workspace-service"
import {
  buildWorkspaceNameLookup,
  type WorkspaceAssignmentMap,
  type WorkspaceAssignmentOption,
} from "@/lib/workspace/assignment"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { subscribeToCatalog } from "@/lib/queries/document-catalog"
import type { DocumentState } from "@/lib/writings/document-state"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { ImportWritingDialog } from "@/components/desk/import-writing-dialog"
import { buildMarkdownDownloadName, serializeWritingToMarkdown } from "@/lib/export/to-markdown"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { downloadBlob, saveBinaryArtifact } from "@/lib/utils/download"
import { buildWebWritingActionUrl, openExternalUrl, type WebWritingAction } from "@/lib/runtime/external-link"


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

/**
 * "No artifacts at all" — state 2 of `docs/design/views/empty-states.md`,
 * rendered inside the sheet so the header, its primary action and the rail all
 * stay put (requirement 4).
 *
 * "Restore starter documents" has no mechanism behind it yet: the repo has no
 * starter-document seeding at all, so the button states that in `title` rather
 * than pretending. Raised as a Context Gap on ODE-438.
 */
function DeskEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div data-testid="desk-empty">
      <NoArtifactsEmptyState
        onCreate={onCreate}
        restoreDisabledReason={STARTER_DOCUMENTS_UNAVAILABLE}
      />
    </div>
  )
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
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceAssignmentOption[]>([])
  const [workspaceAssignments, setWorkspaceAssignments] = useState<WorkspaceAssignmentMap>({})
  const [workspaceAvailable, setWorkspaceAvailable] = useState(false)
  const recipientPreviewsRef = useRef(recipientPreviewsByWritingId)
  const workspaceAssignmentsRef = useRef(workspaceAssignments)
  const workspaceOptionsRef = useRef(workspaceOptions)
  const workspaceNamesRef = useRef<Record<string, string>>({})
  const hasHydratedRemoteRef = useRef(false)
  const hasLoadedSharedRef = useRef(false)
  const sharingService = useMemo(() => createSharingService(), [])
  const router = useRouter()

  recipientPreviewsRef.current = recipientPreviewsByWritingId

  const workspaceNamesBySlug = useMemo(
    () => buildWorkspaceNameLookup(workspaceOptions),
    [workspaceOptions],
  )
  workspaceAssignmentsRef.current = workspaceAssignments
  workspaceOptionsRef.current = workspaceOptions
  workspaceNamesRef.current = workspaceNamesBySlug

  const {
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    selectedArtifactTypes,
    selectedWorkspaceSlugs,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    groupBy,
    sortBy,
    setSearchQuery,
    toggleCollection,
    toggleStatus,
    toggleArtifactType,
    toggleWorkspace,
    setCreatedDateFilter,
    setCreatedDateFrom,
    setCreatedDateTo,
    setGroupBy,
    setSortBy,
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
        const previewResult = await sharingService.listRecipientPreviews(writingIds)
        if (previewResult.error || !previewResult.data) {
          return Object.fromEntries(
            writingIds.map((id) => [id, [] as RecipientPreview[]]),
          )
        }

        // Ensure every requested ID has an entry (backend returns [] for non-owned or missing)
        const previewsByWritingId: Record<string, RecipientPreview[]> = {}
        for (const id of writingIds) {
          previewsByWritingId[id] = previewResult.data[id] ?? []
        }
        return previewsByWritingId
      } catch {
        return Object.fromEntries(
          writingIds.map((id) => [id, [] as RecipientPreview[]]),
        )
      }
    },
    [sharingService],
  )

  const syncRemoteWritings = useCallback(async () => {
    try {
      const syncService = getSyncService()
      await Promise.all([
        syncService.hydrateWritings().then((r) => r.data).catch(() => null),
        syncService.hydrateCollections().then((r) => r.data).catch(() => null),
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

      // Desktop without a signed-in session stays local-first: no requests to Supabase or /api/*.
      if (isTauriRuntime() && getLocalDBScope() === "anonymous") {
        hasHydratedRemoteRef.current = true
        return
      }

      // Explicit refresh flows (window focus / online / scope change with force)
      // must bypass the freshness window on both runtimes.
      if (force) {
        if (!isTauriRuntime()) {
          invalidateWebWritingsHydrationFreshness()
          invalidateWebCollectionsHydrationFreshness()
        }
      }

      const hydrated = await syncRemoteWritings()
      hasHydratedRemoteRef.current = hydrated
    },
    [syncRemoteWritings],
  )

  const documentStateByIdRef = useRef<Record<string, DocumentState>>({})

  const loadDeskActivity = useCallback(async () => {
    // Base set + authoritative state come from the DocumentCatalog through the
    // application port; the Desk presentation never reads storage directly.
    const { writings, documentStateById, collections: nextCollections, writingCollections: nextAssignments } =
      await loadDeskCatalogData()
    const localScope = getLocalDBScope()

    documentStateByIdRef.current = documentStateById
    setRawWritings(writings)
    setSummary(
      buildDeskActivitySummary(writings, {
        filter: "all",
        userId: localScope === "anonymous" ? null : localScope,
        recipientPreviewsByWritingId: recipientPreviewsRef.current,
        assignments: nextAssignments,
        collectionOptions: buildCollectionOptions(nextCollections),
        groupBy,
        sortBy,
        workspaceAssignments: workspaceAssignmentsRef.current,
        workspaceNamesBySlug: workspaceNamesRef.current,
        workspaceOptions: workspaceOptionsRef.current,
        documentStateById,
      }),
    )
    setCollections(nextCollections)
    setWritingCollections(nextAssignments)
  }, [groupBy, sortBy])

  const refreshWorkspaceAssignments = useCallback(async () => {
    const service = getWorkspaceAssignmentService()
    const assignments = await service.listAssignments()
    workspaceAssignmentsRef.current = assignments
    setWorkspaceAssignments(assignments)
  }, [])

  const loadWorkspaceData = useCallback(async () => {
    const service = getWorkspaceAssignmentService()
    setWorkspaceAvailable(service.isAvailable)

    if (!service.isAvailable) {
      workspaceAssignmentsRef.current = {}
      workspaceOptionsRef.current = []
      workspaceNamesRef.current = {}
      setWorkspaceOptions([])
      setWorkspaceAssignments({})
      return
    }

    const [options, assignments] = await Promise.all([
      service.listWorkspaces(),
      service.listAssignments(),
    ])
    workspaceAssignmentsRef.current = assignments
    workspaceOptionsRef.current = options
    workspaceNamesRef.current = buildWorkspaceNameLookup(options)
    setWorkspaceOptions(options)
    setWorkspaceAssignments(assignments)
  }, [])

  const assignWorkspace = useCallback(
    async (writingId: string, slug: string) => {
      const service = getWorkspaceAssignmentService()
      try {
        // Folder-backed target: this physically moves the `.md` (ADR D7
        // amended). A failed move throws with nothing durable written.
        await service.assign(writingId, slug)
      } catch (error) {
        console.error("[desk:workspace-move]", error)
      }
      // Always reload from the catalog so the UI reflects reality — success
      // shows the new location, failure never fakes one.
      await refreshWorkspaceAssignments()
      await loadDeskActivity()
    },
    [loadDeskActivity, refreshWorkspaceAssignments],
  )

  const unassignWorkspace = useCallback(
    async (writingId: string) => {
      const service = getWorkspaceAssignmentService()
      try {
        // Folder-backed membership: this returns the `.md` to Writings.
        await service.clearAssignment(writingId)
      } catch (error) {
        console.error("[desk:workspace-remove]", error)
      }
      await refreshWorkspaceAssignments()
      await loadDeskActivity()
    },
    [loadDeskActivity, refreshWorkspaceAssignments],
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
      await loadDeskActivity()
    },
    [loadDeskActivity, loadWorkspaceData],
  )

  const loadRecipientPreviewsAsync = useCallback(async () => {
    const sharedWritingIds = await loadSharedWritingIds()

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
        const sharedResult = await sharingService.listIncomingShares()
        if (sharedResult.error || !sharedResult.data) {
          throw new Error(sharedResult.error?.message ?? "Failed to load shared writings.")
        }

        setSharedItems(sharedResult.data)
        hasLoadedSharedRef.current = true
      } catch (error) {
        setSharedItems([])
        setSharedError(error instanceof Error ? error.message : "Failed to load shared writings.")
      } finally {
        setIsSharedLoading(false)
      }
    },
    [sharingService],
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
      try {
        // 0. Load desktop-local workspace metadata so rows can show assignments
        await loadWorkspaceData()
        // 1. Render local data immediately — don't wait for remote
        await loadDeskActivity()
        void loadRecipientPreviewsAsync()
      } finally {
        // The loading state always has an exit. A rejected local read leaves the
        // view showing what it has and an actionable surface, never skeletons
        // that never resolve.
        if (!cancelled) {
          setIsLoading(false)
        }
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
  }, [activeView, hydrateRemoteIfNeeded, loadDeskActivity, loadRecipientPreviewsAsync, loadWorkspaceData])

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

  // Desk reacts to DocumentCatalog change bursts. On web the catalog adapter
  // wraps the same IndexedDB store, so this replaces the old localDB subscription;
  // on desktop a global WorkspaceReconciler burst (watcher-discovered file,
  // rename, bulk rescan) emits one CatalogChange, keeping Desk consistent without
  // navigating to Workspace first (ODE-373 req 4). The reconciler coalesces the
  // burst and the debounce collapses any residual fan-out into one reload
  // (Performance Contract: reactive fan-out).
  useEffect(() => {
    const debounced = debounce(
      () => {
        if (activeView === "mine") {
          void loadDeskActivity()
        }
      },
      100,
      { leading: false, trailing: true },
    )

    const unsubscribeCatalog = subscribeToCatalog(debounced)
    const unsubscribeCollections = subscribeToCollectionChanges(debounced)
    return () => {
      unsubscribeCatalog()
      unsubscribeCollections()
      debounced.cancel()
    }
  }, [activeView, loadDeskActivity])

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

  // Eagerly load the shared-with-me count so the tab counter is accurate even
  // when the user has not yet opened the shared view. The runtime-specific
  // sharing service (web fetch vs. desktop Supabase) is selected by the factory.
  useEffect(() => {
    void loadSharedWritings()
  }, [loadSharedWritings])

  const collectionOptions = useMemo(() => buildCollectionOptions(collections), [collections])
  const writingById = useMemo(() => {
    return new Map(rawWritings.map((writing) => [writing.id, writing]))
  }, [rawWritings])
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
      assignments: writingCollections,
      collectionOptions,
      groupBy,
      sortBy,
      workspaceAssignments,
      workspaceNamesBySlug,
      workspaceOptions,
      documentStateById: documentStateByIdRef.current,
      clientFilter: {
        searchQuery,
        selectedCollectionIds,
        selectedStatuses,
        selectedArtifactTypes,
        selectedWorkspaceSlugs,
        createdDateFilter,
        createdDateFrom,
        createdDateTo,
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
    selectedArtifactTypes,
    selectedWorkspaceSlugs,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    groupBy,
    sortBy,
    writingCollections,
    collectionOptions,
    workspaceAssignments,
    workspaceNamesBySlug,
    workspaceOptions,
  ])

  const visibleWritingIds = useMemo(() => {
    return filteredSummary.groups.flatMap((group) => group.rows.map((row) => row.id))
  }, [filteredSummary])

  const previewRows = useMemo(() => {
    return filteredSummary.groups.flatMap((group) => group.rows)
  }, [filteredSummary])

  /**
   * The row shows a relative date and carries the absolute one in `title`. Both
   * come from the catalog records already loaded for the view — no extra query.
   */
  const absoluteDatesByWritingId = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" })
    return Object.fromEntries(
      rawWritings.map((writing) => {
        const stamp = writing.updated_at ?? writing.created_at
        const parsed = stamp ? new Date(stamp) : null
        return [
          writing.id,
          parsed && !Number.isNaN(parsed.getTime()) ? formatter.format(parsed) : "",
        ]
      }),
    )
  }, [rawWritings])

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
    const writing = await getWritingForEdit(writingId)
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
      await toggleWritingCollectionMutation(
        writingId,
        collectionId,
        writingCollections,
      )
    },
    [writingCollections],
  )

  const createWritingCollection = useCallback(
    async (writingId: string, name: string) => {
      const ownerId = getLocalDBScope()
      await createAndAssignCollection(
        writingId,
        name,
        ownerId === "anonymous" ? null : ownerId,
        writingCollections,
      )
    },
    [writingCollections],
  )

  const saveWritingTitle = useCallback(
    async (nextTitle: string) => {
      if (!renameTarget) {
        return
      }

      await renameWriting(renameTarget.id, nextTitle)
      await loadDeskActivity()
      void loadRecipientPreviewsAsync()
    },
    [renameTarget, loadDeskActivity, loadRecipientPreviewsAsync],
  )

  const handleTitleChange = useCallback(
    async (writingId: string, nextTitle: string) => {
      await renameWriting(writingId, nextTitle)
      await loadDeskActivity()
      void loadRecipientPreviewsAsync()
    },
    [loadDeskActivity, loadRecipientPreviewsAsync],
  )

  const getWritingMarkdownPayload = useCallback((writingId: string) => {
    const writing = writingById.get(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return null
    }

    const markdown = serializeWritingToMarkdown(writing.body_json).trimEnd()
    return {
      markdown: `${markdown}\n`,
      filename: buildMarkdownDownloadName({
        title: writing.title,
        bodyText: writing.body_text,
        writingId: writing.id,
      }),
    }
  }, [writingById])

  const copyWritingMarkdown = useCallback(async (writingId: string) => {
    const payload = getWritingMarkdownPayload(writingId)

    if (!payload) {
      return
    }

    await copyTextWithFallback(payload.markdown)
  }, [getWritingMarkdownPayload])

  const downloadWritingMarkdown = useCallback((writingId: string) => {
    const payload = getWritingMarkdownPayload(writingId)

    if (!payload) {
      return
    }

    const blob = new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" })
    downloadBlob(blob, payload.filename)
  }, [getWritingMarkdownPayload])

  const exportWritingDocument = useCallback(async (writingId: string, format: "pdf" | "docx") => {
    const service = await getDocumentService()
    const result = await service.exportWriting({ writingId, format })
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? `Failed to export ${format.toUpperCase()}.`)
    }

    await saveBinaryArtifact(result.data)
  }, [])

  const shareWritingFromPreview = useCallback(
    async (writingId: string) => {
      const existing = await sharingService.getPreviewLink(writingId)
      if (existing.error) {
        return { ok: false, message: existing.error.message }
      }

      let link = existing.data?.active ? existing.data.link : null
      if (!link) {
        const rotated = await sharingService.rotatePreviewLink(writingId)
        if (rotated.error || !rotated.data?.link) {
          return {
            ok: false,
            message: rotated.error?.message ?? "Sharing becomes available after the first sync.",
          }
        }
        link = rotated.data.link
      }

      const copied = await copyTextWithFallback(link)
      return copied
        ? { ok: true, message: "Share link copied to clipboard." }
        : { ok: false, message: "Couldn't copy the link. Open the editor to share." }
    },
    [sharingService],
  )

  const openPreviewWebAction = useCallback(async (writingId: string, action: WebWritingAction) => {
    const url = buildWebWritingActionUrl({ writingId, action })
    if (!url) throw new Error("Web publishing is not configured for this environment.")
    await openExternalUrl(url)
  }, [])

  const openFullWriting = useCallback(
    (writingId: string) => {
      const target = previewRows.find((candidate) => candidate.id === writingId)
      const href = target?.destinationHref ?? buildWritingRouteHref("/write", { id: writingId, slug: null })
      router.push(href)
    },
    [previewRows, router],
  )

  const deleteWritingFromPreview = useCallback(
    async (writingId: string) => {
      await deleteWriting(writingId)
      await loadDeskActivity()
      void loadRecipientPreviewsAsync()
    },
    [loadDeskActivity, loadRecipientPreviewsAsync],
  )

  return (
    <section id="desk" data-page="desk" className="Desk flex h-screen min-h-0 flex-col bg-bg">
      <ViewTitlebarSpacer />
      {activeView === "mine" ? (
        <>
          <DeskHeader />

          <DeskFilterBar
                leading={<DeskViewToggle activeView={activeView} counts={viewCounts} onViewChange={updateActiveView} />}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedCollectionIds={selectedCollectionIds}
                onToggleCollection={toggleCollection}
                selectedStatuses={selectedStatuses}
                onToggleStatus={toggleStatus}
                selectedArtifactTypes={selectedArtifactTypes}
                onToggleArtifactType={toggleArtifactType}
                selectedWorkspaceSlugs={selectedWorkspaceSlugs}
                onToggleWorkspace={toggleWorkspace}
                createdDateFilter={createdDateFilter}
                onCreatedDateFilterChange={setCreatedDateFilter}
                createdDateFrom={createdDateFrom}
                onCreatedDateFromChange={setCreatedDateFrom}
                createdDateTo={createdDateTo}
                onCreatedDateToChange={setCreatedDateTo}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                sortBy={sortBy}
                onSortByChange={setSortBy}
                collectionOptions={collectionOptions}
                workspaceOptions={workspaceOptions}
                activeFilterCount={activeFilterCount}
                hasActiveFilters={hasActiveFilters}
                filteredCount={filteredSummary.total}
                totalCount={summary.total}
                onClearFilters={clearFilters}
              />

          {/*
            Layer 1 — the sheet. It is the positioning context for the selection
            bar, which the prototype anchors inside it rather than to the window.
          */}
          <div
            data-testid="desk-sheet"
            className="relative mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-sb shadow-float"
          >
            <DeskArtifactList
              groups={filteredSummary.groups}
              isLoading={isLoading}
              emptyState={
                hasActiveFilters ? (
                  <DeskFilterEmptyState onClear={clearFilters} />
                ) : (
                  <DeskEmptyState onCreate={() => router.push("/write?new=1")} />
                )
              }
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              onActivate={(row) => {
                if (row.destinationHref) router.push(row.destinationHref)
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
              onDeleteRequest={async (id) => {
                await deleteWriting(id)
                await loadDeskActivity()
                void loadRecipientPreviewsAsync()
              }}
              absoluteDates={absoluteDatesByWritingId}
            />

            {hasSelection && (
              <BulkActionBar
                placement="absolute"
                selectedCount={selectedCount}
                visibleCount={visibleWritingIds.length}
                allVisibleSelected={allVisibleSelected}
                onSelectAll={() => selectAll(visibleWritingIds)}
                onDeselectAll={deselectAll}
                onDelete={() => setIsBulkDeleteOpen(true)}
                onStatusChange={async (status) => {
                  await bulkChangeStatus(selectedIds, status)
                }}
                onArtifactTypeChange={async (artifactType) => {
                  await bulkChangeArtifactType(selectedIds, artifactType)
                }}
                collectionOptions={collectionOptions}
                onAddToCollection={async (collectionId) => {
                  await bulkAddToCollection(selectedIds, collectionId, writingCollections)
                }}
                onCreateCollection={async (name) => {
                  const ownerId = getLocalDBScope()
                  await bulkCreateCollection(
                    selectedIds,
                    name,
                    ownerId === "anonymous" ? null : ownerId,
                    writingCollections,
                  )
                }}
              />
            )}
          </div>

          <DeleteWritingDialog
            open={isBulkDeleteOpen}
            onOpenChange={setIsBulkDeleteOpen}
            count={selectedCount}
            onConfirm={async () => {
              await bulkDelete(selectedIds)
              deselectAll()
              await loadDeskActivity()
              void loadRecipientPreviewsAsync()
            }}
          />

          <RenameWritingModal
            open={renameTarget !== null}
            title={renameTarget?.title ?? "Untitled writing"}
            bodyText={renameTarget?.bodyText ?? ""}
            writingId={renameTarget?.id}
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
            onArtifactTypeChange={changeWritingArtifactType}
            workspaceOptions={workspaceOptions}
            workspaceAvailable={workspaceAvailable}
            onAssignWorkspace={assignWorkspace}
            onUnassignWorkspace={unassignWorkspace}
            onCreateWorkspace={createWorkspaceAndAssign}
            onTitleChange={handleTitleChange}
            onOpenFullWriting={openFullWriting}
            onExportMarkdown={downloadWritingMarkdown}
            onExportDocument={exportWritingDocument}
            onShare={shareWritingFromPreview}
            onOpenWebAction={openPreviewWebAction}
            onDelete={deleteWritingFromPreview}
          />
        </>
      ) : (
        <>
          <DeskHeader />
          <div className="flex flex-shrink-0 flex-wrap items-center gap-[14px] px-4 pb-3">
            <DeskViewToggle activeView={activeView} counts={viewCounts} onViewChange={updateActiveView} />
          </div>
          <div className="relative mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-sb shadow-float">
            <div className="od-scroll min-h-0 flex-1 overflow-y-auto">
              <SharedWithMeList items={sharedItems} isLoading={isSharedLoading} error={sharedError} />
            </div>
          </div>
        </>
      )}
      <ImportWritingDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
    </section>
  )
}
