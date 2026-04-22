import { describe, expect, it } from "vitest"
import {
  buildCollectionSummaries,
  buildCollectionWritingMap,
  dedupeCollectionIds,
  getUncategorizedWritings,
  getWritingCollectionIds,
} from "../lib/collections/collections"
import type { LocalCollection, LocalWriting, LocalWritingCollection } from "../lib/local-db/schema"

const writings: LocalWriting[] = [
  {
    id: "writing-1",
    title: "One",
    body_json: { type: "doc" },
    body_text: "First",
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-04-21T00:00:00.000Z",
    updated_at: "2026-04-21T00:00:00.000Z",
    local_updated_at: 1,
  },
  {
    id: "writing-2",
    title: "Two",
    body_json: { type: "doc" },
    body_text: "Second",
    status: "finished",
    visibility: "public",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-04-21T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    local_updated_at: 2,
  },
]

const collections: LocalCollection[] = [
  {
    id: "collection-1",
    owner_id: "user-1",
    name: "Letters",
    description: null,
    visibility: "private",
    sync_status: "synced",
    lifecycle: "server-confirmed",
    deleted_at: null,
    created_at: "2026-04-21T00:00:00.000Z",
    updated_at: "2026-04-21T00:00:00.000Z",
    local_updated_at: 1,
  },
  {
    id: "collection-2",
    owner_id: "user-1",
    name: "Public",
    description: null,
    visibility: "public",
    sync_status: "synced",
    lifecycle: "server-confirmed",
    deleted_at: null,
    created_at: "2026-04-21T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    local_updated_at: 2,
  },
]

const assignments: LocalWritingCollection[] = [
  {
    id: "writing-2:collection-2",
    writing_id: "writing-2",
    collection_id: "collection-2",
    added_at: "2026-04-22T00:00:00.000Z",
    local_updated_at: 2,
  },
]

describe("collections helpers", () => {
  it("detects uncategorized writings", () => {
    expect(getUncategorizedWritings(writings, assignments).map((writing) => writing.id)).toEqual([
      "writing-1",
    ])
  })

  it("returns collection ids for a writing", () => {
    expect(getWritingCollectionIds("writing-2", assignments)).toEqual(["collection-2"])
  })

  it("builds summaries ordered by count and recency", () => {
    expect(buildCollectionSummaries(collections, writings, assignments)[0]?.id).toBe("collection-2")
  })

  it("groups writings by collection", () => {
    const grouped = buildCollectionWritingMap(writings, assignments)
    expect(grouped.get("collection-2")?.[0]?.id).toBe("writing-2")
  })

  it("dedupes collection ids", () => {
    expect(dedupeCollectionIds(["a", "b", "a"])).toEqual(["a", "b"])
  })
})
