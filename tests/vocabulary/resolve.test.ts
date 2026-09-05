import { describe, expect, it } from "vitest"
import { getVocabularyLabel, getVocabularyColor, getVocabularyIconName, getVocabularyPosition, listVisibleVocabulary, resolveVocabularyItem } from "@/lib/vocabulary/resolve"
import { VOCABULARY_COLORS } from "@/lib/settings/vocabulary"
import type { VocabularyItem } from "@/lib/vocabulary/types"

function item(overrides: Partial<VocabularyItem> & Pick<VocabularyItem, "kind" | "key">): VocabularyItem {
  return {
    id: `${overrides.kind}:${overrides.key}`,
    name: overrides.key,
    description: "",
    icon: "compass",
    color: "#5B5BD6",
    hidden: false,
    isBase: false,
    isRequired: false,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("resolveVocabularyItem", () => {
  it("resolves a known item verbatim", () => {
    const catalog = [item({ kind: "status", key: "draft", name: "Draft", color: "#C07B2A" })]
    const resolved = resolveVocabularyItem(catalog, "status", "draft")
    expect(resolved.isUnknown).toBe(false)
    expect(resolved.name).toBe("Draft")
    expect(resolved.color).toBe("#C07B2A")
  })

  it("gives an unknown value a defined, consistent, neutral presentation (requirement 6)", () => {
    const catalog = [item({ kind: "status", key: "draft" })]
    const resolved = resolveVocabularyItem(catalog, "status", "some-deleted-custom-status")
    expect(resolved.isUnknown).toBe(true)
    // The raw key is the label — never blank, never "undefined".
    expect(resolved.name).toBe("some-deleted-custom-status")
    expect(resolved.icon).toBeNull()
    // Neutral color is one of the admissible palette hexes (Grey).
    expect(VOCABULARY_COLORS.some((c) => c.hex === resolved.color)).toBe(true)
  })

  it("never confuses a type key with a status key of the same string", () => {
    const catalog = [
      item({ kind: "type", key: "draft", name: "Draft (a type, unusually)" }),
    ]
    const resolved = resolveVocabularyItem(catalog, "status", "draft")
    expect(resolved.isUnknown).toBe(true)
  })
})

describe("thin accessors", () => {
  const catalog = [
    item({ kind: "status", key: "draft", name: "Draft", color: "#C07B2A", icon: "circle-dashed", position: 2 }),
  ]

  it("getVocabularyLabel", () => {
    expect(getVocabularyLabel(catalog, "status", "draft")).toBe("Draft")
    expect(getVocabularyLabel(catalog, "status", "ghost")).toBe("ghost")
  })
  it("getVocabularyColor", () => {
    expect(getVocabularyColor(catalog, "status", "draft")).toBe("#C07B2A")
  })
  it("getVocabularyIconName", () => {
    expect(getVocabularyIconName(catalog, "status", "draft")).toBe("circle-dashed")
    expect(getVocabularyIconName(catalog, "status", "ghost")).toBeNull()
  })
  it("getVocabularyPosition", () => {
    expect(getVocabularyPosition(catalog, "status", "draft")).toBe(2)
  })
})

describe("listVisibleVocabulary", () => {
  it("excludes hidden items and sorts by position (requirement 8)", () => {
    const catalog = [
      item({ kind: "status", key: "b", position: 2, hidden: false }),
      item({ kind: "status", key: "a", position: 1, hidden: false }),
      item({ kind: "status", key: "hidden-one", position: 0, hidden: true }),
      item({ kind: "type", key: "irrelevant", position: 0, hidden: false }),
    ]
    const result = listVisibleVocabulary(catalog, "status")
    expect(result.map((i) => i.key)).toEqual(["a", "b"])
  })
})
