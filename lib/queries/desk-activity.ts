import type { LocalWriting } from "@/lib/local-db/schema"

export type DeskActivityFilter = "all" | "correspondence" | "with-responses" | "received"

export type DeskBadgeTone = "private" | "shared" | "public"

export type DeskRecipientPreview = {
  username: string
  displayName: string | null
}

export type DeskHeroDraft = {
  id: string
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
  stateTone: DeskBadgeTone
  withLabel: string
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

type BuildDeskActivityOptions = {
  filter: DeskActivityFilter
  userId?: string | null
  now?: Date
  recipientPreviewsByWritingId?: Record<string, DeskRecipientPreview[]>
}

type WritingMeta = {
  id: string
  title: string
  excerpt: string
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
    return "Empty draft"
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
    return new Intl.DateTimeFormat(formatterOptions.locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(updatedAt)
  }

  if (now.getTime() - updatedAt.getTime() < WEEK_IN_MS) {
    return new Intl.DateTimeFormat(formatterOptions.locale, { weekday: "short" }).format(updatedAt)
  }

  return new Intl.DateTimeFormat(formatterOptions.locale, {
    month: "short",
    day: "numeric",
  }).format(updatedAt)
}

const buildVisibilityLabel = (
  visibility: LocalWriting["visibility"],
): Pick<DeskActivityRow, "stateLabel" | "stateTone" | "withLabel"> => {
  if (visibility === "shared") {
    return {
      stateLabel: "Compartido",
      stateTone: "shared",
      withLabel: "",
    }
  }

  if (visibility === "public") {
    return {
      stateLabel: "Público",
      stateTone: "public",
      withLabel: "",
    }
  }

  return {
    stateLabel: "Privado",
    stateTone: "private",
    withLabel: "",
  }
}

const formatRecipientLabels = (previews: DeskRecipientPreview[]) => {
  const handles = [
    ...new Map(
      previews
        .map((preview) => ({
          username: preview.username.trim(),
          displayName: preview.displayName?.trim() ?? null,
        }))
        .filter((preview) => preview.username.length > 0)
        .map((preview) => [preview.username, preview] as const),
    ).values(),
  ]

  if (handles.length === 0) {
    return ""
  }

  return handles.map((preview) => `@${preview.username}`).join(", ")
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
        title: buildTitle(writing.title),
        excerpt: buildExcerpt(writing.body_text),
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

const buildGroups = (writings: WritingMeta[], now: Date): DeskActivityGroup[] => {
  const groups: DeskActivityGroup[] = [
    { label: "Today", rows: [] },
    { label: "This week", rows: [] },
    { label: "Earlier", rows: [] },
  ]

  for (const writing of writings) {
    const visibilityState = buildVisibilityLabel(writing.visibility)
    const row: DeskActivityRow = {
      id: writing.id,
      title: writing.title,
      excerpt: writing.excerpt,
      stateLabel: visibilityState.stateLabel,
      stateTone: visibilityState.stateTone,
      withLabel:
        writing.visibility === "shared"
          ? formatRecipientLabels(writing.recipientPreviews)
          : visibilityState.withLabel,
      recipientPreviews: writing.recipientPreviews,
      dateLabel: `Modificado · ${buildDateLabel(writing.updatedAt, now)}`,
      isNew: writing.isReceived,
      destinationHref: writing.isReceived ? null : `/write/${writing.id}`,
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
  const drafts = writings.filter((writing) => writing.status === "draft").slice(0, 8)

  return drafts.map((draft, index) => ({
    id: draft.id,
    title: draft.title,
    excerpt: draft.excerpt,
    statusLabel: index === 0 ? "In progress" : "Draft",
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
  const filtered = applyFilter(allWritings, options.filter)

  return {
    heroDrafts: buildHeroDrafts(allWritings, now),
    groups: buildGroups(filtered, now),
    counts: buildCounts(allWritings),
    total: filtered.length,
  }
}
