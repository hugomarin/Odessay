import { beforeEach, describe, expect, it } from "vitest"
import {
  clearCatalogTitleCache,
  emitCatalogTitleChange,
  getLatestCatalogTitle,
} from "../lib/events/catalog-title-events"

describe("catalog title events", () => {
  beforeEach(() => {
    clearCatalogTitleCache()
  })

  it("retains the latest catalog title by stable writing UUID", () => {
    const writingId = crypto.randomUUID()

    emitCatalogTitleChange(new Map([[writingId, "Case4-renamed"]]))

    expect(getLatestCatalogTitle(writingId)).toBe("Case4-renamed")
  })

  it("evicts the oldest entries when the cache exceeds the size limit", () => {
    // Fill the cache to exactly its capacity (100 entries).
    const entries = Array.from({ length: 100 }, (_, i) => [`id-${i}`, `Title ${i}`] as const)
    emitCatalogTitleChange(new Map(entries.map(([id, title]) => [id, title])))

    // Adding one more should evict the oldest entry (id-0).
    emitCatalogTitleChange(new Map([["id-new", "New Title"]]))

    expect(getLatestCatalogTitle("id-0")).toBeNull()
    expect(getLatestCatalogTitle("id-1")).toBe("Title 1")
    expect(getLatestCatalogTitle("id-new")).toBe("New Title")
  })

  it("refreshing an existing entry prevents it from being evicted", () => {
    const entries = Array.from({ length: 100 }, (_, i) => [`id-${i}`, `Title ${i}`] as const)
    emitCatalogTitleChange(new Map(entries.map(([id, title]) => [id, title])))

    // Touch id-0 so it becomes most-recent.
    expect(getLatestCatalogTitle("id-0")).toBe("Title 0")

    // The next insertion should evict id-1, not id-0.
    emitCatalogTitleChange(new Map([["id-new", "New Title"]]))

    expect(getLatestCatalogTitle("id-0")).toBe("Title 0")
    expect(getLatestCatalogTitle("id-1")).toBeNull()
  })
})
