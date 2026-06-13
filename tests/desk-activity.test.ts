import { describe, expect, it } from "vitest"
import { buildDeskActivitySummary } from "../lib/queries/desk-activity"
import type { LocalWriting } from "../lib/local-db/schema"

const now = new Date("2026-03-19T15:30:00.000Z")

const createWriting = (partial: Partial<LocalWriting> & Pick<LocalWriting, "id">): LocalWriting => ({
  id: partial.id,
  title: partial.title ?? "Untitled writing",
  body_json: partial.body_json ?? { type: "doc" },
  body_text: partial.body_text ?? "Default body",
  status: partial.status ?? "draft",
  visibility: partial.visibility ?? "private",
  version: partial.version ?? 1,
  sync_status: partial.sync_status ?? "synced",
  lifecycle: partial.lifecycle ?? "server-confirmed",
  created_at: partial.created_at ?? "2026-03-10T00:00:00.000Z",
  updated_at: partial.updated_at ?? "2026-03-10T00:00:00.000Z",
  local_updated_at: partial.local_updated_at ?? 1,
  author_id: partial.author_id ?? "user-1",
  correspondence_id: partial.correspondence_id ?? null,
  parent_id: partial.parent_id ?? null,
  slug: partial.slug ?? null,
  deleted_at: partial.deleted_at ?? null,
})

describe("buildDeskActivitySummary", () => {
  const writings: LocalWriting[] = [
    createWriting({
      id: "draft-today",
      title: "Today draft",
      slug: "today-draft",
      body_text: "hello world from today",
      created_at: "2026-03-19T11:00:00.000Z",
      updated_at: "2026-03-19T11:00:00.000Z",
      local_updated_at: 5,
      status: "draft",
      visibility: "private",
    }),
    createWriting({
      id: "corr-week",
      title: "Weekly correspondence",
      body_text: "weekly correspondence content",
      created_at: "2026-03-17T11:00:00.000Z",
      updated_at: "2026-03-17T11:00:00.000Z",
      local_updated_at: 4,
      status: "done",
      visibility: "shared",
    }),
    createWriting({
      id: "reply-earlier",
      title: "Earlier reply",
      body_text: "earlier reply content",
      created_at: "2026-02-25T10:00:00.000Z",
      updated_at: "2026-02-25T10:00:00.000Z",
      local_updated_at: 3,
      status: "done",
      visibility: "private",
      parent_id: "corr-week",
      author_id: "user-2",
    }),
    createWriting({
      id: "deleted-item",
      title: "Deleted draft",
      body_text: "deleted",
      created_at: "2026-03-19T10:00:00.000Z",
      updated_at: "2026-03-19T10:00:00.000Z",
      local_updated_at: 6,
      sync_status: "deleted",
    }),
  ]

  it("groups activity as Today / This week / Earlier", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      recipientPreviewsByWritingId: {
        "corr-week": [
          { username: "ana", displayName: "Ana Pérez" },
          { username: "luis", displayName: "Luis Gómez" },
        ],
      },
    })

    expect(summary.groups.map((group) => group.label)).toEqual(["Today", "This week", "Earlier"])
    expect(summary.counts.all).toBe(3)
    expect(summary.groups[0]?.rows[0]?.title).toBe("Today draft")
    expect(summary.groups[2]?.rows[0]?.title).toBe("Earlier reply")
  })

  it("filters correspondence and response-driven views", () => {
    const correspondence = buildDeskActivitySummary(writings, {
      filter: "correspondence",
      userId: "user-1",
      now,
    })

    const withResponses = buildDeskActivitySummary(writings, {
      filter: "with-responses",
      userId: "user-1",
      now,
    })

    expect(correspondence.total).toBe(2)
    expect(correspondence.groups.flatMap((group) => group.rows).map((row) => row.title)).toEqual([
      "Weekly correspondence",
      "Earlier reply",
    ])
    expect(correspondence.counts.correspondence).toBe(2)

    expect(withResponses.total).toBe(1)
    expect(withResponses.groups[0]?.rows[0]?.stateLabel).toBe("Done")
  })

  it("marks received activity based on author id", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "received",
      userId: "user-1",
      now,
    })

    expect(summary.total).toBe(1)
    expect(summary.groups[0]?.rows[0]?.title).toBe("Earlier reply")
    expect(summary.groups[0]?.rows[0]?.stateTone).toBe("done")
    expect(summary.groups[0]?.rows[0]?.destinationHref).toBeNull()
    expect(summary.counts.received).toBe(1)
  })

  it("keeps editor route only for writings owned by the author context", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
    })

    const todayRow = summary.groups.flatMap((group) => group.rows).find((row) => row.title === "Today draft")
    const receivedRow = summary.groups.flatMap((group) => group.rows).find((row) => row.title === "Earlier reply")

    expect(todayRow?.destinationHref).toBe("/write/today-draft")
    expect(receivedRow?.destinationHref).toBeNull()
    expect(todayRow?.stateLabel).toBe("Draft")
    expect(todayRow?.dateLabel).toBe("")
  })

  it("renders shared recipient names directly when provided", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      recipientPreviewsByWritingId: {
        "corr-week": [
          { username: "ana", displayName: "Ana Pérez" },
          { username: "luis", displayName: "Luis Gómez" },
        ],
      },
    })

    const sharedRow = summary.groups.flatMap((group) => group.rows).find((row) => row.title === "Weekly correspondence")

    expect(sharedRow?.stateLabel).toBe("Done")
    expect(sharedRow?.recipientPreviews[0]?.username).toBe("ana")
  })

  it("filters by search query on title and body_text", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      clientFilter: {
        searchQuery: "weekly",
      },
    })

    expect(summary.total).toBe(1)
    expect(summary.groups[0]?.rows[0]?.title).toBe("Weekly correspondence")
  })

  it("filters by status", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      clientFilter: {
        selectedStatuses: ["done"],
      },
    })

    expect(summary.total).toBe(2)
    const titles = summary.groups.flatMap((group) => group.rows).map((row) => row.title)
    expect(titles).toEqual(["Weekly correspondence", "Earlier reply"])
  })

  it("filters by collection assignments", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      clientFilter: {
        selectedCollectionIds: ["coll-1"],
        assignments: [
          { id: "a1", writing_id: "draft-today", collection_id: "coll-1", added_at: "2026-03-19T00:00:00.000Z", local_updated_at: 1 },
        ],
      },
    })

    expect(summary.total).toBe(1)
    expect(summary.groups[0]?.rows[0]?.title).toBe("Today draft")
  })

  it("filters by uncategorized collection", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      clientFilter: {
        selectedCollectionIds: ["uncategorized"],
        assignments: [
          { id: "a1", writing_id: "draft-today", collection_id: "coll-1", added_at: "2026-03-19T00:00:00.000Z", local_updated_at: 1 },
        ],
      },
    })

    expect(summary.total).toBe(2)
    const titles = summary.groups.flatMap((group) => group.rows).map((row) => row.title)
    expect(titles).toContain("Weekly correspondence")
    expect(titles).toContain("Earlier reply")
  })

  it("filters by multiple criteria combined", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      clientFilter: {
        searchQuery: "reply",
        selectedStatuses: ["done"],
      },
    })

    expect(summary.total).toBe(1)
    expect(summary.groups[0]?.rows[0]?.title).toBe("Earlier reply")
  })

  it("returns empty groups when no writings match filters", () => {
    const summary = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
      clientFilter: {
        searchQuery: "nonexistent",
      },
    })

    expect(summary.total).toBe(0)
    expect(summary.groups).toEqual([])
    expect(summary.heroDrafts.length).toBeGreaterThan(0)
  })

  it("keeps main list order stable when a writing's metadata changes", () => {
    const before = buildDeskActivitySummary(writings, {
      filter: "all",
      userId: "user-1",
      now,
    })

    const titlesBefore = before.groups.flatMap((group) => group.rows).map((row) => row.title)
    expect(titlesBefore).toEqual(["Today draft", "Weekly correspondence", "Earlier reply"])

    const changed = writings.map((writing) =>
      writing.id === "reply-earlier"
        ? {
            ...writing,
            status: "in_review" as const,
            updated_at: "2026-03-19T12:00:00.000Z",
            local_updated_at: 10,
          }
        : writing,
    )

    const after = buildDeskActivitySummary(changed, {
      filter: "all",
      userId: "user-1",
      now,
    })

    const titlesAfter = after.groups.flatMap((group) => group.rows).map((row) => row.title)
    expect(titlesAfter).toEqual(["Today draft", "Weekly correspondence", "Earlier reply"])
  })
})
