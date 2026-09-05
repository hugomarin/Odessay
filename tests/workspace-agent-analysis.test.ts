import { describe, expect, it } from "vitest"
import {
  buildWorkflowDraft,
  detectBrokenDocumentReferences,
  detectDocumentContradictions,
  findArchiveCandidates,
  replaceBrokenDocumentReference,
  replaceContradictionFragment,
  suggestArtifactClassification,
} from "@/lib/agent/workspace-agent-analysis"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { VocabularyItem } from "@/lib/vocabulary/types"

const record = (
  id: string,
  title: string,
  overrides: Partial<DocumentCatalogRecord> = {},
): DocumentCatalogRecord => ({
  id,
  localPresent: true,
  cloudPresent: false,
  cloudAccountId: null,
  syncStatus: "local-only",
  title,
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  version: 1,
  deletedAt: null,
  createdAt: 1_700_000_000_000,
  modifiedAt: 1_700_000_000_000,
  binding: {
    documentId: id,
    bindingRootId: "root",
    relativePath: `${title}.md`,
    canonicalPath: `/workspace/${title}.md`,
    inode: 1,
    contentHash: `hash:${id}`,
    size: 10,
    lastSeenAt: 1_700_000_000_000,
  },
  ...overrides,
})

const vocabulary = (items: Array<Partial<VocabularyItem> & Pick<VocabularyItem, "kind" | "key">>): VocabularyItem[] =>
  items.map((item, index) => ({
    id: item.id ?? `${item.kind}:${item.key}`,
    name: item.name ?? item.key,
    description: item.description ?? "",
    icon: item.icon ?? "file-text",
    color: item.color ?? "#000000",
    hidden: item.hidden ?? false,
    isBase: item.isBase ?? false,
    isRequired: item.isRequired ?? false,
    position: item.position ?? index,
    createdAt: item.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: item.updatedAt ?? "2026-01-01T00:00:00.000Z",
    kind: item.kind,
    key: item.key,
  }))

describe("Workspace agent analysis", () => {
  it("builds workflow.md only from catalog, collection and annotation evidence", () => {
    const proposal = buildWorkflowDraft({
      rootPath: "/workspace",
      documents: [
        record("workflow", "workflow", { binding: { ...record("workflow", "workflow").binding!, canonicalPath: "/workspace/workflow.md", relativePath: "workflow.md" } }),
        record("doc-1", "Research"),
      ],
      collections: [{
        id: "collection-1", name: "Research", description: "Open questions", visibility: "private", writingsCount: 1, updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      annotations: [{ documentId: "doc-1", count: 2, labels: ["question"] }],
      existingWorkflow: { documentId: "workflow", markdown: "old workflow" },
    })

    expect(proposal.existingDocumentId).toBe("workflow")
    expect(proposal.markdown).toContain("Research")
    expect(proposal.markdown).toContain("2 annotation(s)")
    expect(proposal.markdown).not.toContain("old workflow")
    expect(proposal.evidence.map((item) => item.sourceId)).toContain("doc-1")
  })

  it("detects broken path references without loading document bodies", () => {
    const result = detectBrokenDocumentReferences([
      record("source", "Source", { excerpt: "See [missing](missing.md) and [present](present.md)." }),
      record("present", "Present", { binding: { ...record("present", "Present").binding!, relativePath: "present.md", canonicalPath: "/workspace/present.md" } }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ sourceDocumentId: "source", reference: "missing.md", candidateDocumentId: null, suggestedReference: null })
  })

  it("builds an editable replacement from the nearest catalog match", () => {
    const result = detectBrokenDocumentReferences([
      record("source", "Source", { excerpt: "See [project plan](project-plan-old.md)." }),
      record("candidate", "Project plan", {
        slug: "project-plan",
        binding: { ...record("candidate", "Project plan").binding!, relativePath: "notes/project-plan.md", canonicalPath: "/workspace/notes/project-plan.md" },
      }),
    ])

    expect(result[0]).toMatchObject({
      candidateDocumentId: "candidate",
      suggestedReference: "notes/project-plan.md",
    })
    expect(replaceBrokenDocumentReference("See [project plan](project-plan-old.md).", result[0]!, "notes/project-plan.md"))
      .toBe("See [project plan](notes/project-plan.md).")
  })

  it("never suggests a type or status outside the current vocabulary", () => {
    const result = suggestArtifactClassification(
      record("target", "Design system", { excerpt: "tokens spacing" }),
      [record("target", "Design system", { excerpt: "tokens spacing" }), record("peer", "Design system notes", { excerpt: "tokens spacing", artifactType: "custom-type", status: "custom-status" })],
      vocabulary([
        { kind: "type", key: "general" },
        { kind: "status", key: "draft" },
      ]),
    )

    expect(result.artifactType).toBeNull()
    expect(result.status).toBeNull()
    expect(result.evidence[0]?.kind).toBe("similarity")
  })

  it("surfaces stale and duplicate candidates with cited reasons, without using sync state", () => {
    const now = 1_800_000_000_000
    const candidates = findArchiveCandidates(
      [
        record("old", "Project plan", { modifiedAt: now - 120 * 24 * 60 * 60 * 1000, excerpt: "launch plan milestones" }),
        record("new", "Project plan copy", { modifiedAt: now - 2 * 24 * 60 * 60 * 1000, excerpt: "launch plan milestones" }),
      ],
      vocabulary([{ kind: "status", key: "archived" }]),
      { now, staleAfterDays: 90, duplicateThreshold: 0.5 },
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ documentId: "old", duplicateOfDocumentId: "new", suggestedStatus: "archived" })
    expect(candidates[0]?.evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["date", "similarity"]))
  })

  it("detects multiple contradictions with exact fragments and evidence", () => {
    const proposals = detectDocumentContradictions([
      {
        documentId: "left",
        title: "Architecture decision",
        markdown: "Storage: SQLite.\nThe editor uses local files.",
        updatedAt: "2026-01-02T00:00:00.000Z",
        canonicalPath: "/workspace/architecture.md",
      },
      {
        documentId: "right",
        title: "Migration note",
        markdown: "Storage: IndexedDB.\nThe editor does not use local files.",
        updatedAt: "2026-01-03T00:00:00.000Z",
        canonicalPath: "/workspace/migration.md",
      },
    ])

    expect(proposals).toHaveLength(2)
    expect(proposals[0]?.suggestedDocumentId).toBe("right")
    expect(proposals.flatMap((proposal) => proposal.evidence.map((item) => item.detail))).toEqual(
      expect.arrayContaining(["line 1: Storage: SQLite.", "line 1: Storage: IndexedDB."]),
    )
  })

  it("rejects stale contradiction offsets before writing a replacement", () => {
    const fragment = { text: "Storage: SQLite.", start: 0, end: 16, line: 1 }
    expect(replaceContradictionFragment("Storage: Postgres.", fragment, "Storage: SQLite.")).toBeNull()
    expect(replaceContradictionFragment("Storage: SQLite.", fragment, "Storage: IndexedDB.")).toBe("Storage: IndexedDB.")
  })

  it("rebases a contradiction fragment when an earlier edit changes document length", () => {
    const fragment = { text: "Storage: SQLite.", start: 0, end: 16, line: 1 }
    expect(replaceContradictionFragment("Intro added.\nStorage: SQLite.", fragment, "Storage: IndexedDB."))
      .toBe("Intro added.\nStorage: IndexedDB.")
  })
})
