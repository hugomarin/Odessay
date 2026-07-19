import { describe, expect, it } from "vitest"
// @ts-expect-error — cleanup tooling is intentionally shipped as native ESM JavaScript.
import * as cleanup from "../scripts/document-cleanup/lib.mjs"

const { buildCleanupRecommendations, classifyMarkdown, splitFrontmatter } = cleanup

type RecommendationRow = {
  id: string
  recommendedAction: "keep" | "manual-review" | "delete-candidate"
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  bodyHash: "same-body",
  isEmpty: false,
  emptyKind: null,
  fileExists: true,
  manifestMatches: true,
  managedRoot: true,
  cloudPresent: false,
  unsyncedMutationCount: 0,
  syncStatus: "local-only",
  decisionTimestampMs: 1,
  ...overrides,
})

describe("desktop document cleanup audit", () => {
  it("classifies blank, complete frontmatter, partial frontmatter and title-only documents as empty", () => {
    expect(classifyMarkdown("", { filename: "Empty.md" }).emptyKind).toBe("blank")
    expect(classifyMarkdown("---\nid: old-id\nstatus: draft\n---\n", { filename: "Legacy.md" }).emptyKind)
      .toBe("frontmatter-only")
    expect(classifyMarkdown("---\nid: old-id\nstatus: draft", { filename: "Legacy.md" }).emptyKind)
      .toBe("frontmatter-fragment-only")
    expect(classifyMarkdown("# My Note", { filename: "My Note.md" }).emptyKind).toBe("title-only")
    expect(classifyMarkdown("# Different", { filename: "My Note.md" }).emptyKind).toBeNull()
  })

  it("strips a leading frontmatter block for body comparison", () => {
    expect(splitFrontmatter("---\nid: one\n---\nSame body").body).toBe("Same body")
    expect(splitFrontmatter("---\nid: two\n---\nSame body").body).toBe("Same body")
  })

  it("keeps the newest equivalent duplicate and proposes older safe rows", () => {
    const older = entry({ id: "older", decisionTimestampMs: 10 })
    const newer = entry({ id: "newer", decisionTimestampMs: 20 })
    const result = buildCleanupRecommendations([older, newer])
    expect(result.duplicateGroups[0].keeperId).toBe("newer")
    expect(result.entries.find((row: RecommendationRow) => row.id === "older")?.recommendedAction).toBe("delete-candidate")
    expect(result.entries.find((row: RecommendationRow) => row.id === "newer")?.recommendedAction).toBe("keep")
  })

  it("protects cloud identity even when a local-only duplicate is newer", () => {
    const cloud = entry({ id: "cloud", cloudPresent: true, decisionTimestampMs: 10 })
    const newerLocal = entry({ id: "new-local", decisionTimestampMs: 20 })
    const result = buildCleanupRecommendations([cloud, newerLocal])
    expect(result.duplicateGroups[0].keeperId).toBe("cloud")
    expect(result.entries.find((row: RecommendationRow) => row.id === "new-local")?.recommendedAction).toBe("delete-candidate")
  })

  it("never auto-proposes external, cloud or unsynced empty documents", () => {
    const result = buildCleanupRecommendations([
      entry({ id: "external", isEmpty: true, emptyKind: "blank", managedRoot: false }),
      entry({ id: "cloud", isEmpty: true, emptyKind: "blank", cloudPresent: true }),
      entry({ id: "pending", isEmpty: true, emptyKind: "blank", unsyncedMutationCount: 1 }),
    ])
    expect(result.entries.every((row: RecommendationRow) => row.recommendedAction === "manual-review")).toBe(true)
  })
})
