/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { createEditorHydrationRecord, type HydrationLocalMetadata } from "@/lib/editor/document-hydration"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { WritingRecord } from "@/lib/services/contracts/document-service"

const id = "c054ac0b-7984-4669-a35d-191d9322c02c"
const canonicalPath = "/Writings/Los escritores de Closet.md"
const richText = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Canonical markdown body" }] }],
}

const openedWriting: WritingRecord = {
  id,
  authorId: "user-1",
  title: "Los escritores de Closet",
  content: {
    markdown: null,
    richText,
    plainText: "Canonical markdown body",
    canonicalSource: "markdown",
  },
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  parentId: null,
  correspondenceId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
}

const staleIndexedDbWriting: LocalWriting = {
  id,
  author_id: "user-1",
  title: "Los escritores de Closet",
  canonical_path: canonicalPath,
  body_json: { type: "doc", content: [{ type: "paragraph" }] },
  body_text: "",
  status: "draft",
  artifact_type: "general",
  visibility: "private",
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
  local_updated_at: 1,
}

// The domain-shaped translation of `staleIndexedDbWriting` a caller would
// actually pass to `createEditorHydrationRecord` — HydrationLocalMetadata is
// camelCase and storage-agnostic; it is never the raw LocalWriting row.
const staleLocalMetadata: HydrationLocalMetadata = {
  canonicalPath: staleIndexedDbWriting.canonical_path,
  lifecycle: staleIndexedDbWriting.lifecycle,
  syncStatus: staleIndexedDbWriting.sync_status,
}

const catalogRecord: DocumentCatalogRecord = {
  id,
  localPresent: true,
  cloudPresent: true,
  cloudAccountId: "user-1",
  syncStatus: "synced",
  title: "Los escritores de Closet",
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  version: 1,
  deletedAt: null,
  createdAt: 1,
  modifiedAt: 2,
  binding: {
    documentId: id,
    bindingRootId: "root-1",
    relativePath: "Los escritores de Closet.md",
    canonicalPath,
    inode: 1,
    contentHash: "blake3:body",
    size: 7310,
    lastSeenAt: 2,
  },
}

describe("editor document hydration", () => {
  it("keeps DocumentService content when legacy IndexedDB contains an empty body", () => {
    const hydrated = createEditorHydrationRecord(openedWriting, {
      catalogRecord,
      localMetadata: staleLocalMetadata,
    })

    expect(hydrated.writing.content.richText).toEqual(richText)
    expect(hydrated.writing.content.plainText).toBe("Canonical markdown body")
    expect(hydrated.canonicalPath).toBe(canonicalPath)
    expect(hydrated.lifecycle).toBe("server-confirmed")
    expect(hydrated.syncStatus).toBe("synced")
  })

  it("uses IndexedDB only as a metadata fallback when no catalog record is available", () => {
    const hydrated = createEditorHydrationRecord(openedWriting, {
      localMetadata: staleLocalMetadata,
    })

    expect(hydrated.writing).toBe(openedWriting)
    expect(hydrated.canonicalPath).toBe(canonicalPath)
  })

  it("parses canonical markdown when a desktop service does not provide rich text", () => {
    const markdownOnlyWriting: WritingRecord = {
      ...openedWriting,
      content: {
        markdown: "# Canonical title\n\nBody from disk",
        richText: null,
        plainText: "",
        canonicalSource: "markdown",
      },
    }

    const hydrated = createEditorHydrationRecord(markdownOnlyWriting)

    expect(hydrated.writing.content.plainText).toContain("Body from disk")
    expect(hydrated.writing.content.richText).toMatchObject({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 } },
        { type: "paragraph", content: [{ type: "text", text: "Body from disk" }] },
      ],
    })
  })
})
