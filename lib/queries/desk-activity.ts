import type { LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema"
import { getWritingStatusLabel, isOpenWritingStatus, normalizeWritingStatus } from "@/lib/writings/status"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { UNCATEGORIZED_COLLECTION_ID } from "@/lib/collections/collections"

export type DeskActivityFilter = "all" | "correspondence" | "with-responses" | "received"

export type DeskStatusTone = "new" | "exploring" | "draft" | "done"

export type DeskRecipientPreview = {
  username: string
  displayName: string | null
}

export type DeskHeroDraft = {
  id: string
  slug: string | null
  title: string
  excerpt: string
  statusLabel: string
  updatedLabel: string
  wordCount: number
  isActive: boolean
}

export type DeskActivityRow = {
  id: string
  title: string
  excerpt: string
  stateLabel: string
  stateTone: DeskStatusTone
  recipientPreviews: DeskRecipientPreview[]
  dateLabel: string
  isNew: boolean
  destinationHref: string | null
}

export type DeskActivityGroup = {
  label: "Today" | "This week" | "Earlier"
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
  assignments?: LocalWritingCollection[]
}

type BuildDeskActivityOptions = {
  filter: DeskActivityFilter
  userId?: string | null
  now?: Date
  recipientPreviewsByWritingId?: Record<string, DeskRecipientPreview[]>
  clientFilter?: DeskClientFilter
}

type WritingMeta = {
  id: string
  slug: string | null
  title: string
  excerpt: string
  bodyText: string
  updatedAt: Date
  wordCount: number
  isCorrespondence: boolean
  hasResponses: boolean
  isReceived: boolean
  status: LocalWriting["status"]
  visibility: LocalWriting["visibility"]
  recipientPreviews: DeskRecipientPreview[]
}

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000

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
  return trimmed?.length ? trimmed : "Untitled writing"
}

const buildDateLabel = (updatedAt: Date, now: Date) => {
  const formatterOptions = {
    locale: "es-MX",
  } as const
  const today = updatedAt.toDateString() === now.toDateString()

  if (today) {
    return ""
  }

  if (now.getTime() - updatedAt.getTime() < WEEK_IN_MS) {
    return new Intl.DateTimeFormat(formatterOptions.locale, { weekday: "short" }).format(updatedAt)
  }

  return new Intl.DateTimeFormat(formatterOptions.locale, {
    month: "short",
    day: "numeric",
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

const buildMetas = (
  writings: LocalWriting[],
  userId?: string | null,
  recipientPreviewsByWritingId?: Record<string, DeskRecipientPreview[]>,
): WritingMeta[] => {
  const activeWritings = writings.filter((writing) => writing.sync_status !== "deleted")
  const childrenByParent = new Map<string, number>()

  for (const writing of activeWritings) {
    if (writing.parent_id) {
      childrenByParent.set(writing.parent_id, (childrenByParent.get(writing.parent_id) ?? 0) + 1)
    }
  }

  return activeWritings
    .map((writing) => {
      const updatedAtRaw = writing.updated_at || writing.created_at
      const updatedAt = toDate(updatedAtRaw)
      const authorId = writing.author_id ?? null
      const isReceived = Boolean(userId && authorId && authorId !== userId)

      return {
        id: writing.id,
        slug: writing.slug ?? null,
        title: buildTitle(writing.title),
        excerpt: buildExcerpt(writing.body_text),
        bodyText: writing.body_text,
        updatedAt,
        wordCount: buildWordCount(writing.body_text),
        isCorrespondence: Boolean(
          writing.correspondence_id ||
            writing.parent_id ||
            (childrenByParent.get(writing.id) ?? 0) > 0,
        ),
        hasResponses: (childrenByParent.get(writing.id) ?? 0) > 0,
        isReceived,
        status: writing.status,
        visibility: writing.visibility,
        recipientPreviews: recipientPreviewsByWritingId?.[writing.id] ?? [],
      }
    })
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
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

const applyClientFilters = (writings: WritingMeta[], clientFilter: DeskClientFilter): WritingMeta[] => {
  const { searchQuery, selectedCollectionIds, selectedStatuses, assignments } = clientFilter

  if (!searchQuery && !selectedCollectionIds?.length && !selectedStatuses?.length) {
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
      const writingCollectionIds = assignmentsByWritingId.get(writing.id) ?? []

      const hasRealCollection = selectedRealCollections.size > 0 &&
        writingCollectionIds.some((id) => selectedRealCollections.has(id))

      const isUncategorized = hasUncategorized && writingCollectionIds.length === 0

      if (!hasRealCollection && !isUncategorized) {
        return false
      }
    }

    return true
  })
}

const buildGroups = (writings: WritingMeta[], now: Date): DeskActivityGroup[] => {
  const groups: DeskActivityGroup[] = [
    { label: "Today", rows: [] },
    { label: "This week", rows: [] },
    { label: "Earlier", rows: [] },
  ]

  for (const writing of writings) {
    const statusState = buildStatusLabel(writing.status)
    const row: DeskActivityRow = {
      id: writing.id,
      title: writing.title,
      excerpt: writing.excerpt,
      stateLabel: statusState.stateLabel,
      stateTone: statusState.stateTone,
      recipientPreviews: writing.recipientPreviews,
      dateLabel: buildDateLabel(writing.updatedAt, now),
      isNew: writing.isReceived,
      destinationHref: writing.isReceived
        ? null
        : buildWritingRouteHref("/write", { id: writing.id, slug: writing.slug }),
    }

    if (writing.updatedAt.toDateString() === now.toDateString()) {
      groups[0].rows.push(row)
      continue
    }

    if (now.getTime() - writing.updatedAt.getTime() < WEEK_IN_MS) {
      groups[1].rows.push(row)
      continue
    }

    groups[2].rows.push(row)
  }

  return groups.filter((group) => group.rows.length > 0)
}

const buildHeroDrafts = (writings: WritingMeta[], now: Date): DeskHeroDraft[] => {
  const drafts = writings.filter((writing) => isOpenWritingStatus(writing.status)).slice(0, 8)

  return drafts.map((draft, index) => ({
    id: draft.id,
    slug: draft.slug,
    title: draft.title,
    excerpt: draft.excerpt,
    statusLabel: getWritingStatusLabel(draft.status),
    updatedLabel: buildDateLabel(draft.updatedAt, now),
    wordCount: draft.wordCount,
    isActive: index === 0,
  }))
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
  const allWritings = buildMetas(writings, options.userId, options.recipientPreviewsByWritingId)
  let filtered = applyFilter(allWritings, options.filter)

  if (options.clientFilter) {
    filtered = applyClientFilters(filtered, options.clientFilter)
  }

  return {
    heroDrafts: buildHeroDrafts(allWritings, now),
    groups: buildGroups(filtered, now),
    counts: buildCounts(allWritings),
    total: filtered.length,
  }
}
