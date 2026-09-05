import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getVocabularyCatalogSnapshot,
  resetVocabularyCatalogForTest,
  setVocabularyCatalog,
  subscribeVocabularyCatalog,
} from "@/lib/vocabulary/catalog"
import type { VocabularyItem } from "@/lib/vocabulary/types"

function customItem(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: "custom-1",
    kind: "type",
    key: "research",
    name: "Research",
    description: "",
    icon: "compass",
    color: "#5B5BD6",
    hidden: false,
    isBase: false,
    isRequired: false,
    position: 99,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("vocabulary catalog singleton", () => {
  beforeEach(() => {
    resetVocabularyCatalogForTest()
  })

  it("defaults to exactly the 13 base items before anything is set", () => {
    const snapshot = getVocabularyCatalogSnapshot()
    expect(snapshot).toHaveLength(13)
    expect(snapshot.every((item) => item.isBase)).toBe(true)
  })

  it("reflects whatever is set", () => {
    const items = [customItem()]
    setVocabularyCatalog(items)
    expect(getVocabularyCatalogSnapshot()).toEqual(items)
  })

  it("never becomes an empty list — an empty set falls back to base items (failure mode)", () => {
    setVocabularyCatalog([customItem()])
    setVocabularyCatalog([])
    expect(getVocabularyCatalogSnapshot().length).toBeGreaterThan(0)
    expect(getVocabularyCatalogSnapshot().every((item) => item.isBase)).toBe(true)
  })

  it("notifies subscribers exactly once per setVocabularyCatalog call, regardless of item count", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeVocabularyCatalog(listener)

    setVocabularyCatalog([customItem({ id: "a" }), customItem({ id: "b" }), customItem({ id: "c" })])
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setVocabularyCatalog([customItem({ id: "d" })])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
