"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { debounce } from "@/lib/utils/debounce"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import {
  buildDeskActivitySummary,
  type DeskActivitySummary,
} from "@/lib/queries/desk-activity"
import {
  createLocalCollection,
  getLocalDBScope,
  getWritingForEdit,
  loadDeskCatalogData,
  loadSharedWritingIds,
  setLocalWritingCollections,
  subscribeToLocalDBScopeChanges,
} from "@/lib/queries/desk-catalog-source"
import { createSharingService } from "@/lib/services/sharing-service-factory"
import { type RecipientPreview } from "@/lib/services/web-sharing-service"
import type { SharedWritingListItem } from "@/lib/sharing/writing-shares"
import { enqueueWritingDelete, enqueueWritingUpsert } from "@/lib/sync/queue"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import { getSyncService } from "@/lib/sync"
import { invalidateHydrationFreshness } from "@/lib/sync/desktop-sync-service"
import { invalidateWebWritingsHydrationFreshness } from "@/lib/sync/remote-bootstrap"
import { invalidateWebCollectionsHydrationFreshness } from "@/lib/collections/remote-bootstrap"
import { getAuthService } from "@/lib/services/auth-service-factory"
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
  workspaceNamesRef.current = workspaceNamesBySlug

  const {
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    selectedArtifactTypes,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    groupBy,
    sortBy,
    setSearchQuery,
    toggleCollection,
    toggleStatus,
    toggleArtifactType,
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
        if (isTauriRuntime()) {
          const sessionResult = await getAuthService().getSession()
          const userId = sessionResult.data?.user?.id
          if (userId) {
            invalidateHydrationFreshness(userId)
          }
        } else {
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
      setWorkspaceOptions([])
      setWorkspaceAssignments({})
      return
    }

    const [options, assignments] = await Promise.all([
      service.listWorkspaces(),
      service.listAssignments(),
    ])
    workspaceAssignmentsRef.current = assignments
    setWorkspaceOptions(options)
    setWorkspaceAssignments(assignments)
  }, [])

  const assignWorkspace = useCallback(
    async (writingId: string, slug: string) => {
      const service = getWorkspaceAssignmentService()
      await service.assign(writingId, slug)
      await refreshWorkspaceAssignments()
      await loadDeskActivity()
    },
    [loadDeskActivity, refreshWorkspaceAssignments],
  )

  const unassignWorkspace = useCallback(
    async (writingId: string) => {
      const service = getWorkspaceAssignmentService()
      await service.clearAssignment(writingId)
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
      // 0. Load desktop-local workspace metadata so rows can show assignments
      await loadWorkspaceData()
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

    const unsubscribe = subscribeToCatalog(debounced)
    return () => {
      unsubscribe()
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
      documentStateById: documentStateByIdRef.current,
      clientFilter: {
        searchQuery,
        selectedCollectionIds,
        selectedStatuses,
        selectedArtifactTypes,
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
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    groupBy,
    sortBy,
    writingCollections,
    collectionOptions,
    workspaceAssignments,
    workspaceNamesBySlug,
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
      const currentIds = getWritingCollectionIds(writingId, writingCollections)
      const nextIds = currentIds.includes(collectionId)
        ? currentIds.filter((id) => id !== collectionId)
        : [...currentIds, collectionId]

      await setLocalWritingCollections(writingId, dedupeCollectionIds(nextIds))
      void getSyncService().scheduleFlush()
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
      void getSyncService().scheduleFlush()
    },
    [writingCollections],
  )

  const changeWritingStatus = useCallback(async (writingId: string, status: LocalWriting["status"]) => {
    const writing = await getWritingForEdit(writingId)
    if (!writing || writing.sync_status === "deleted") {
      return
    }
    if (writing.status === status) {
      return
    }

    const nowIso = new Date().toISOString()
    const updatedWriting: LocalWriting = {
      ...writing,
      status,
      version: writing.version + 1,
      updated_at: nowIso,
      metadata_updated_at: nowIso,
      local_updated_at: Date.now(),
    }

    await enqueueWritingUpsert(updatedWriting)
  }, [])

  const changeWritingArtifactType = useCallback(async (writingId: string, artifactType: ArtifactType) => {
    const writing = await getWritingForEdit(writingId)
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
  }, [])

  const saveWritingTitleById = useCallback(
    async (writingId: string, nextTitle: string) => {
      const writing = await getWritingForEdit(writingId)
      if (!writing || writing.sync_status === "deleted") {
        return
      }

      const trimmedTitle = nextTitle.trim() || "Untitled writing"
      if ((writing.title?.trim() || "Untitled writing") === trimmedTitle) {
        return
      }

      const nowIso = new Date().toISOString()
      await enqueueWritingUpsert({
        ...writing,
        title: trimmedTitle,
        version: writing.version + 1,
        updated_at: nowIso,
        content_updated_at: nowIso,
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
      await enqueueWritingDelete(writingId)
      await loadDeskActivity()
      void loadRecipientPreviewsAsync()
    },
    [loadDeskActivity, loadRecipientPreviewsAsync],
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
            href="/write?new=1"
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

          <div className="px-5 py-[14px] sm:px-9">
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
                activeFilterCount={activeFilterCount}
                hasActiveFilters={hasActiveFilters}
                filteredCount={filteredSummary.total}
                totalCount={summary.total}
              />
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
              onArtifactTypeChange={async (artifactType) => {
                for (const writingId of Array.from(selectedIds)) {
                  await changeWritingArtifactType(writingId, artifactType)
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
                void getSyncService().scheduleFlush()
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
                void getSyncService().scheduleFlush()
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
              onToggleCollection={toggleWritingCollection}
              onCreateCollection={createWritingCollection}
              onStatusChange={changeWritingStatus}
              onArtifactTypeChange={changeWritingArtifactType}
              onRenameWriting={openRenameWriting}
              onPreviewWriting={openWritingPreview}
              onCopyMarkdown={copyWritingMarkdown}
              onDownloadMarkdown={downloadWritingMarkdown}
              onDeleteRequest={async (id) => {
                await enqueueWritingDelete(id)
                await loadDeskActivity()
                void loadRecipientPreviewsAsync()
              }}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              showWorkspaceColumn={false}
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
            onTitleChange={saveWritingTitleById}
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
