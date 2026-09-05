import { describe, expect, it } from "vitest"
import { mergeVocabulary } from "@/lib/vocabulary/merge"
import type { VocabularyItem } from "@/lib/vocabulary/types"

function item(overrides: Partial<VocabularyItem> & Pick<VocabularyItem, "kind" | "key" | "updatedAt">): VocabularyItem {
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
    createdAt: overrides.updatedAt,
    ...overrides,
  }
}

describe("mergeVocabulary", () => {
  it("keeps an identical item on both sides with no writes either way", () => {
    const shared = item({ kind: "type", key: "general", updatedAt: "2026-01-01T00:00:00.000Z" })
    const result = mergeVocabulary([shared], [shared])
    expect(result.merged).toEqual([shared])
    expect(result.localWrites).toEqual([])
    expect(result.cloudWrites).toEqual([])
  })

  it("local-only item uploads to the cloud", () => {
    const local = item({ kind: "type", key: "research", updatedAt: "2026-01-01T00:00:00.000Z" })
    const result = mergeVocabulary([local], [])
    expect(result.merged).toEqual([local])
    expect(result.cloudWrites).toEqual([local])
    expect(result.localWrites).toEqual([])
  })

  it("cloud-only item downloads to local", () => {
    const cloud = item({ kind: "status", key: "blocked", updatedAt: "2026-01-01T00:00:00.000Z" })
    const result = mergeVocabulary([], [cloud])
    expect(result.merged).toEqual([cloud])
    expect(result.localWrites).toEqual([cloud])
    expect(result.cloudWrites).toEqual([])
  })

  it("same key, different content: the newer updatedAt wins and is written to the losing side", () => {
    const local = item({ kind: "type", key: "research", name: "Research (local)", updatedAt: "2026-02-01T00:00:00.000Z" })
    const cloud = item({ kind: "type", key: "research", name: "Research (cloud)", updatedAt: "2026-01-01T00:00:00.000Z" })

    const result = mergeVocabulary([local], [cloud])
    expect(result.merged).toEqual([local])
    expect(result.cloudWrites).toEqual([local])
    expect(result.localWrites).toEqual([])
  })

  it("same key, cloud newer: cloud wins and is written locally", () => {
    const local = item({ kind: "type", key: "research", name: "Research (local)", updatedAt: "2026-01-01T00:00:00.000Z" })
    const cloud = item({ kind: "type", key: "research", name: "Research (cloud)", updatedAt: "2026-02-01T00:00:00.000Z" })

    const result = mergeVocabulary([local], [cloud])
    expect(result.merged).toEqual([cloud])
    expect(result.localWrites).toEqual([cloud])
    expect(result.cloudWrites).toEqual([])
  })

  it("base items never duplicate — same key on both sides is one merged row", () => {
    const localDraft = item({ kind: "status", key: "draft", name: "Draft", isBase: true, isRequired: true, updatedAt: "2026-01-01T00:00:00.000Z" })
    const cloudDraft = item({ kind: "status", key: "draft", name: "Draft", isBase: true, isRequired: true, updatedAt: "2026-01-01T00:00:00.000Z" })

    const result = mergeVocabulary([localDraft], [cloudDraft])
    expect(result.merged).toHaveLength(1)
  })

  it("two custom items with the same visible name but different keys are never fused into one", () => {
    const localResearch = item({ kind: "type", key: "research", name: "Notes", updatedAt: "2026-01-01T00:00:00.000Z" })
    const cloudResearchDup = item({ kind: "type", key: "research_2", name: "Notes", updatedAt: "2026-01-01T00:00:00.000Z" })

    const result = mergeVocabulary([localResearch], [cloudResearchDup])
    expect(result.merged).toHaveLength(2)
    expect(result.merged.map((i) => i.key).sort()).toEqual(["research", "research_2"])
  })

  it("is idempotent: running merge again on the already-converged state produces no writes", () => {
    const local = item({ kind: "type", key: "research", name: "Research (local)", updatedAt: "2026-02-01T00:00:00.000Z" })
    const cloud = item({ kind: "type", key: "research", name: "Research (cloud)", updatedAt: "2026-01-01T00:00:00.000Z" })

    const first = mergeVocabulary([local], [cloud])
    // Simulate applying cloudWrites: cloud now has the exact winning item too.
    const convergedCloud = [...first.merged]
    const convergedLocal = [...first.merged]

    const second = mergeVocabulary(convergedLocal, convergedCloud)
    expect(second.localWrites).toEqual([])
    expect(second.cloudWrites).toEqual([])
  })
})
