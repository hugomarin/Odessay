import type { LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import { UNCATEGORIZED_COLLECTION_ID } from "@/lib/collections/collections"
import type { CollectionOption } from "@/lib/collections/collections"
import { getArtifactTypeLabel, normalizeArtifactType, type ArtifactType } from "@/lib/writings/artifact-type"
import {
  getWritingStatusLabel,
  normalizeWritingStatus,
  type WritingStatus,
} from "@/lib/writings/status"
import { deriveDocumentStateForLocalWriting, type DocumentState } from "@/lib/writings/document-state"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import {
  inferWorkspaceSlugFromPath,
  type WorkspaceAssignmentOption,
} from "@/lib/workspace/assignment"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import { orderGroupKeysByCatalog } from "@/lib/vocabulary/resolve"
import type { VocabularyItem } from "@/lib/vocabulary/types"

export type DeskActivityFilter = "all" | "correspondence" | "with-responses" | "received"

/** ODE-474: no longer a locally-declared closed union — alias of the opened `WritingStatus`. */
export type DeskStatusTone = WritingStatus

export type DeskGroupBy = "none" | "status" | "artifact" | "collection" | "created-date"

export type DeskSortBy = "created-at-desc" | "created-at-asc" | "content-updated-at-desc"

export type DeskCreatedDateFilter = "today" | "last-7" | "last-30" | "this-year" | "custom"

export const NO_WORKSPACE_FILTER_VALUE = "__no-workspace__"

export type DeskRecipientPreview = {
  username: string
  displayName: string | null
}

export type DeskHeroDraft = {
  id: string
  slug: string | null
  title: string
  excerpt: string
  documentState: DocumentState
  createdLabel: string
  wordCount: number
  isActive: boolean
  workspaceSlug: string | null
  workspaceName: string | null
}

export type DeskActivityRow = {
  id: string
  title: string
  excerpt: string
  localPath: string | null
  stateLabel: string
  stateTone: DeskStatusTone
  documentState: DocumentState
  artifactType?: ArtifactType
  recipientPreviews: DeskRecipientPreview[]
  dateLabel: string
  isNew: boolean
  destinationHref: string | null
  /** Slug of the writing's primary workspace, or null when unassigned. */
  workspaceSlug: string | null
  /** Display name of the assigned workspace, or null when unassigned. */
  workspaceName: string | null
}

export type DeskActivityGroup = {
  label: string
  rows: DeskActivityRow[]
}

export type DeskActivitySummary = {
  heroDrafts: DeskHeroDraft[]
  groups: DeskActivityGroup[]
  counts: Record<DeskActivityFilter, number>
  total: number
}

export type DeskClientFilter = {
  searchQuery?: string
  selectedCollectionIds?: string[]
  selectedStatuses?: string[]
  selectedArtifactTypes?: ArtifactType[]
  selectedWorkspaceSlugs?: string[]
  createdDateFilter?: DeskCreatedDateFilter | null
  createdDateFrom?: string
  createdDateTo?: string
  assignments?: LocalWritingCollection[]
  groupBy?: DeskGroupBy
  sortBy?: DeskSortBy
}

type BuildDeskActivityOptions = {
  filter: DeskActivityFilter
  userId?: string | null
  now?: Date
  recipientPreviewsByWritingId?: Record<string, DeskRecipientPreview[]>
  clientFilter?: DeskClientFilter
  groupBy?: DeskGroupBy
  sortBy?: DeskSortBy
  assignments?: LocalWritingCollection[]
  collectionOptions?: CollectionOption[]
  /** writing id → workspace slug (contextual document↔workspace assignment). */
  workspaceAssignments?: Record<string, string>
  /** workspace slug → display name, used to resolve the assigned workspace label. */
  workspaceNamesBySlug?: Record<string, string>
  /** Registered Workspace roots used to infer physical membership when no manual override exists. */
  workspaceOptions?: WorkspaceAssignmentOption[]
  /**
   * Authoritative document state per UUID, derived from the DocumentCatalog
   * (ODE-373). When provided it overrides the local presence/sync derivation so
   * Desk renders the same state the catalog reports and the same state Workspace
   * shows for that UUID.
   */
  documentStateById?: Record<string, DocumentState>
  /**
   * Live vocabulary catalog (ODE-476) — governs status/artifact group order.
   * Callers that already subscribe via `useVocabulary()` should pass it through
   * so group order stays in sync with rename/reorder; falls back to the module
   * singleton snapshot for callers (e.g. tests) that don't track it themselves.
   */
  catalog?: readonly VocabularyItem[]
}

type WritingMeta = {
  id: string
  slug: string | null
  title: string
  excerpt: string
  localPath: string | null
  bodyText: string
  createdAt: Date
  updatedAt: Date
  contentUpdatedAt: Date
  metadataUpdatedAt: Date
  wordCount: number
  isCorrespondence: boolean
  hasResponses: boolean
  isReceived: boolean
  status: LocalWriting["status"]
  documentState: DocumentState
  visibility: LocalWriting["visibility"]
  recipientPreviews: DeskRecipientPreview[]
  artifactType: ArtifactType
  collectionIds: string[]
  workspaceSlug: string | null
  workspaceName: string | null
}

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000
const DAY_IN_MS = 24 * 60 * 60 * 1000

const fallbackDate = new Date(0)

const toDate = (value: string | undefined) => {
  if (!value) {
    return fallbackDate
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallbackDate
  }

  return date
}

const buildWordCount = (bodyText: string) => {
  const trimmed = bodyText.trim()
  if (!trimmed) {
    return 0
  }

  return trimmed.split(/\s+/).length
}

const buildExcerpt = (bodyText: string) => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return ""
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}

const buildTitle = (title: string | null | undefined) => {
  const trimmed = title?.trim()
  return trimmed?.length ? trimmed : "Untitled artifact"
}

const buildDateLabel = (updatedAt: Date, now: Date) => {
  if (updatedAt.toDateString() === now.toDateString()) {
    return "Today"
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (updatedAt.toDateString() === yesterday.toDateString()) {
    return "Yesterday"
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(updatedAt)
}

const buildStatusLabel = (
  status: LocalWriting["status"],
): Pick<DeskActivityRow, "stateLabel" | "stateTone"> => {
  const normalized = normalizeWritingStatus(status)
  return {
    stateLabel: getWritingStatusLabel(normalized),
    stateTone: normalized,
  }
}

const startOfDay = (date: Date) => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const endOfDay = (date: Date) => {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

const matchesCreatedDateFilter = (
  createdAt: Date,
  filter: DeskCreatedDateFilter | undefined,
  from: string | undefined,
  to: string | undefined,
  now: Date,
): boolean => {
  if (!filter) {
    return true
  }

  const created = createdAt.getTime()

  switch (filter) {
    case "today": {
      return createdAt.toDateString() === now.toDateString()
    }
    case "last-7": {
      return created >= startOfDay(new Date(now.getTime() - 7 * DAY_IN_MS)).getTime()
    }
    case "last-30": {
      return created >= startOfDay(new Date(now.getTime() - 30 * DAY_IN_MS)).getTime()
    }
    case "this-year": {
      return createdAt.getFullYear() === now.getFullYear()
    }
    case "custom": {
      const fromDate = from ? new Date(from) : null
      const toDate = to ? new Date(to) : null
      if (fromDate && Number.isNaN(fromDate.getTime())) {
        return true
      }
      if (toDate && Number.isNaN(toDate.getTime())) {
        return true
      }
      if (fromDate && created < startOfDay(fromDate).getTime()) {
        return false
      }
      if (toDate && created > endOfDay(toDate).getTime()) {
        return false
      }
      return true
    }
    default:
      return true
  }
}

const buildAssignmentsByWritingId = (assignments: LocalWritingCollection[] | undefined) => {
  const map = new Map<string, string[]>()
  if (!assignments) {
    return map
  }

  for (const assignment of assignments) {
    const current = map.get(assignment.writing_id) ?? []
    current.push(assignment.collection_id)
    map.set(assignment.writing_id, current)
  }

  return map
}

const sortMetas = (metas: WritingMeta[], sortBy?: DeskSortBy): WritingMeta[] => {
  const effectiveSort: DeskSortBy = sortBy ?? "created-at-desc"

  return [...metas].sort((left, right) => {
    switch (effectiveSort) {
      case "created-at-asc":
        return left.createdAt.getTime() - right.createdAt.getTime()
      case "content-updated-at-desc":
        return right.contentUpdatedAt.getTime() - left.contentUpdatedAt.getTime()
      case "created-at-desc":
      default:
        return right.createdAt.getTime() - left.createdAt.getTime()
    }
  })
}

const buildMetas = (
  writings: LocalWriting[],
  userId?: string | null,
  recipientPreviewsByWritingId?: Record<string, DeskRecipientPreview[]>,
  assignmentsByWritingId?: Map<string, string[]>,
  sortBy?: DeskSortBy,
  workspaceAssignments?: Record<string, string>,
  workspaceNamesBySlug?: Record<string, string>,
  workspaceOptions?: WorkspaceAssignmentOption[],
  documentStateById?: Record<string, DocumentState>,
): WritingMeta[] => {
  const activeWritings = writings.filter((writing) => writing.sync_status !== "deleted")
  const childrenByParent = new Map<string, number>()

  for (const writing of activeWritings) {
    if (writing.parent_id) {
      childrenByParent.set(writing.parent_id, (childrenByParent.get(writing.parent_id) ?? 0) + 1)
    }
  }

  const metas = activeWritings.map((writing) => {
    const workspaceSlug =
      workspaceAssignments?.[writing.id] ??
      inferWorkspaceSlugFromPath(writing.canonical_path, workspaceOptions ?? [])
    const workspaceName = workspaceSlug
      ? (workspaceNamesBySlug?.[workspaceSlug] ?? workspaceSlug)
      : null
    const updatedAtRaw = writing.updated_at || writing.created_at
    const updatedAt = toDate(updatedAtRaw)
    const createdAt = toDate(writing.created_at)
    const contentUpdatedAt = toDate(writing.content_updated_at ?? writing.updated_at ?? writing.created_at)
    const metadataUpdatedAt = toDate(writing.metadata_updated_at ?? writing.updated_at ?? writing.created_at)
    const authorId = writing.author_id ?? null
    const isReceived = Boolean(userId && authorId && authorId !== userId)

    return {
      id: writing.id,
      slug: writing.slug ?? null,
      title: buildTitle(writing.title),
      excerpt: buildExcerpt(writing.body_text),
      localPath: writing.canonical_path?.trim() || null,
      bodyText: writing.body_text,
      createdAt,
      updatedAt,
      contentUpdatedAt,
      metadataUpdatedAt,
      wordCount: buildWordCount(writing.body_text),
      isCorrespondence: Boolean(
        writing.correspondence_id ||
          writing.parent_id ||
          (childrenByParent.get(writing.id) ?? 0) > 0,
      ),
      hasResponses: (childrenByParent.get(writing.id) ?? 0) > 0,
      isReceived,
      status: writing.status,
      documentState: documentStateById?.[writing.id] ?? deriveDocumentStateForLocalWriting(writing),
      visibility: writing.visibility,
      recipientPreviews: recipientPreviewsByWritingId?.[writing.id] ?? [],
      artifactType: normalizeArtifactType(writing.artifact_type),
      collectionIds: assignmentsByWritingId?.get(writing.id) ?? [],
      workspaceSlug,
      workspaceName,
    }
  })

  return sortMetas(metas, sortBy)
}

const applyFilter = (writings: WritingMeta[], filter: DeskActivityFilter) => {
  if (filter === "all") {
    return writings
  }

  if (filter === "correspondence") {
    return writings.filter((writing) => writing.isCorrespondence)
  }

  if (filter === "with-responses") {
    return writings.filter((writing) => writing.hasResponses)
  }

  return writings.filter((writing) => writing.isReceived)
}

const normalizeQuery = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

const applyClientFilters = (
  writings: WritingMeta[],
  clientFilter: DeskClientFilter,
  now: Date,
): WritingMeta[] => {
  const {
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    selectedArtifactTypes,
    selectedWorkspaceSlugs,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    assignments,
  } = clientFilter

  const hasAnyFilter =
    searchQuery ||
    selectedCollectionIds?.length ||
    selectedStatuses?.length ||
    selectedArtifactTypes?.length ||
    selectedWorkspaceSlugs?.length ||
    createdDateFilter

  if (!hasAnyFilter) {
    return writings
  }

  const normalizedSearch = searchQuery ? normalizeQuery(searchQuery) : null

  const assignmentsByWritingId = new Map<string, string[]>()
  if (assignments && assignments.length > 0) {
    for (const assignment of assignments) {
      const current = assignmentsByWritingId.get(assignment.writing_id) ?? []
      current.push(assignment.collection_id)
      assignmentsByWritingId.set(assignment.writing_id, current)
    }
  }

  const selectedCollectionSet = new Set(selectedCollectionIds ?? [])
  const selectedWorkspaceSet = new Set(selectedWorkspaceSlugs ?? [])
  const includesNoWorkspace = selectedWorkspaceSet.has(NO_WORKSPACE_FILTER_VALUE)
  const hasUncategorized = selectedCollectionSet.has(UNCATEGORIZED_COLLECTION_ID)
  const selectedRealCollections = new Set(
    (selectedCollectionIds ?? []).filter((id) => id !== UNCATEGORIZED_COLLECTION_ID),
  )

  return writings.filter((writing) => {
    if (normalizedSearch) {
      const inTitle = normalizeQuery(writing.title).includes(normalizedSearch)
      const inBody = normalizeQuery(writing.bodyText).includes(normalizedSearch)
      if (!inTitle && !inBody) {
        return false
      }
    }

    if (selectedStatuses && selectedStatuses.length > 0) {
      const normalized = normalizeWritingStatus(writing.status)
      if (!selectedStatuses.includes(normalized)) {
        return false
      }
    }

    if (selectedCollectionSet.size > 0) {
      const writingCollectionIds = assignmentsByWritingId.get(writing.id) ?? writing.collectionIds

      const hasRealCollection =
        selectedRealCollections.size > 0 &&
        writingCollectionIds.some((id) => selectedRealCollections.has(id))

      const isUncategorized = hasUncategorized && writingCollectionIds.length === 0

      if (!hasRealCollection && !isUncategorized) {
        return false
      }
    }

    if (selectedArtifactTypes && selectedArtifactTypes.length > 0) {
      if (!selectedArtifactTypes.includes(writing.artifactType)) {
        return false
      }
    }

    if (selectedWorkspaceSet.size > 0) {
      const matchesWorkspace = writing.workspaceSlug
        ? selectedWorkspaceSet.has(writing.workspaceSlug)
        : includesNoWorkspace

      if (!matchesWorkspace) {
        return false
      }
    }

    if (createdDateFilter) {
      if (!matchesCreatedDateFilter(writing.createdAt, createdDateFilter, createdDateFrom, createdDateTo, now)) {
        return false
      }
    }

    return true
  })
}

const toActivityRow = (writing: WritingMeta, now: Date): DeskActivityRow => {
  const statusState = buildStatusLabel(writing.status)
  return {
    id: writing.id,
    title: writing.title,
    excerpt: writing.excerpt,
    localPath: writing.localPath,
    stateLabel: statusState.stateLabel,
    stateTone: statusState.stateTone,
    documentState: writing.documentState,
    artifactType: writing.artifactType,
    recipientPreviews: writing.recipientPreviews,
    dateLabel: buildDateLabel(writing.createdAt, now),
    isNew: writing.isReceived,
    destinationHref: writing.isReceived
      ? null
      : buildWritingRouteHref("/write", { id: writing.id, slug: writing.slug }),
    workspaceSlug: writing.workspaceSlug,
    workspaceName: writing.workspaceName,
  }
}

const buildGroups = (
  writings: WritingMeta[],
  now: Date,
  groupBy: DeskGroupBy = "created-date",
  collectionOptions: CollectionOption[] = [],
  catalog: readonly VocabularyItem[] = getVocabularyCatalogSnapshot(),
): DeskActivityGroup[] => {
  if (groupBy === "none") {
    return [
      {
        label: "",
        rows: writings.map((writing) => toActivityRow(writing, now)),
      },
    ]
  }

  if (groupBy === "status") {
    const groups = new Map<DeskStatusTone, DeskActivityRow[]>()
    for (const writing of writings) {
      const normalized = normalizeWritingStatus(writing.status)
      const rows = groups.get(normalized) ?? []
      rows.push(toActivityRow(writing, now))
      groups.set(normalized, rows)
    }

    return orderGroupKeysByCatalog(catalog, "status", groups.keys()).map((status) => ({
      label: getWritingStatusLabel(status as WritingStatus),
      rows: groups.get(status as DeskStatusTone) ?? [],
    }))
  }

  if (groupBy === "artifact") {
    const groups = new Map<ArtifactType, DeskActivityRow[]>()
    for (const writing of writings) {
      const rows = groups.get(writing.artifactType) ?? []
      rows.push(toActivityRow(writing, now))
      groups.set(writing.artifactType, rows)
    }

    return orderGroupKeysByCatalog(catalog, "type", groups.keys()).map((artifactType) => ({
      label: getArtifactTypeLabel(artifactType as ArtifactType),
      rows: groups.get(artifactType as ArtifactType) ?? [],
    }))
  }

  if (groupBy === "collection") {
    const optionById = new Map(collectionOptions.map((option) => [option.id, option]))
    const groups = new Map<string, DeskActivityRow[]>()

    for (const writing of writings) {
      const primaryId = writing.collectionIds[0] ?? UNCATEGORIZED_COLLECTION_ID
      const rows = groups.get(primaryId) ?? []
      rows.push(toActivityRow(writing, now))
      groups.set(primaryId, rows)
    }

    const entries = Array.from(groups.entries()).map(([id, rows]) => ({
      id,
      label: id === UNCATEGORIZED_COLLECTION_ID ? "No collection" : (optionById.get(id)?.name ?? id),
      rows,
    }))

    entries.sort((left, right) => {
      if (left.id === UNCATEGORIZED_COLLECTION_ID) return 1
      if (right.id === UNCATEGORIZED_COLLECTION_ID) return -1
      return left.label.localeCompare(right.label)
    })

    return entries
  }

  const groups: DeskActivityGroup[] = [
    { label: "Today", rows: [] },
    { label: "This week", rows: [] },
    { label: "Earlier", rows: [] },
  ]

  for (const writing of writings) {
    const row = toActivityRow(writing, now)

    if (writing.createdAt.toDateString() === now.toDateString()) {
      groups[0].rows.push(row)
      continue
    }

    if (now.getTime() - writing.createdAt.getTime() < WEEK_IN_MS) {
      groups[1].rows.push(row)
      continue
    }

    groups[2].rows.push(row)
  }

  return groups.filter((group) => group.rows.length > 0)
}

const buildRecentWritings = (writings: WritingMeta[], now: Date): DeskHeroDraft[] => {
  const recent = [...writings]
    .sort((left, right) => right.contentUpdatedAt.getTime() - left.contentUpdatedAt.getTime())
    .slice(0, 10)

  return recent.map((writing, index) => {
    return {
      id: writing.id,
      slug: writing.slug,
      title: writing.title,
      excerpt: writing.excerpt,
      documentState: writing.documentState,
      createdLabel: `Created ${buildDateLabel(writing.createdAt, now) || "today"}`,
      wordCount: writing.wordCount,
      isActive: index === 0,
      workspaceSlug: writing.workspaceSlug,
      workspaceName: writing.workspaceName,
    }
  })
}

const buildCounts = (writings: WritingMeta[]): Record<DeskActivityFilter, number> => ({
  all: writings.length,
  correspondence: writings.filter((writing) => writing.isCorrespondence).length,
  "with-responses": writings.filter((writing) => writing.hasResponses).length,
  received: writings.filter((writing) => writing.isReceived).length,
})

export const buildDeskActivitySummary = (
  writings: LocalWriting[],
  options: BuildDeskActivityOptions,
): DeskActivitySummary => {
  const now = options.now ?? new Date()
  const assignmentsByWritingId = buildAssignmentsByWritingId(options.assignments)
  const allWritings = buildMetas(
    writings,
    options.userId,
    options.recipientPreviewsByWritingId,
    assignmentsByWritingId,
    options.sortBy,
    options.workspaceAssignments,
    options.workspaceNamesBySlug,
    options.workspaceOptions,
    options.documentStateById,
  )
  let filtered = applyFilter(allWritings, options.filter)

  if (options.clientFilter) {
    filtered = applyClientFilters(filtered, options.clientFilter, now)
  }

  const effectiveGroupBy = options.clientFilter?.groupBy ?? options.groupBy ?? "created-date"
  const effectiveSortBy = options.clientFilter?.sortBy ?? options.sortBy ?? "created-at-desc"

  return {
    heroDrafts: buildRecentWritings(allWritings, now),
    groups: buildGroups(
      sortMetas(filtered, effectiveSortBy),
      now,
      effectiveGroupBy,
      options.collectionOptions,
      options.catalog ?? getVocabularyCatalogSnapshot(),
    ),
    counts: buildCounts(allWritings),
    total: filtered.length,
  }
}
