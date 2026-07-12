import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "../lib/local-db"
import type { DocumentCatalogRecord } from "../lib/services/contracts/document-catalog"

const getById = vi.fn()

vi.mock("@/lib/services/document-catalog-factory", () => ({
  getDocumentCatalog: vi.fn(async () => ({ getById })),
}))

import { getWritingForEdit } from "../lib/queries/desk-catalog-source"

describe("getWritingForEdit", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis)
    getById.mockReset()
    setLocalDBScope(`desk-writing-edit-${crypto.randomUUID()}`)
  })

  it("uses the catalog title and binding for rename modals", async () => {
    const writingId = crypto.randomUUID()
    await localDB.writings.save({
      id: writingId,
      author_id: null,
      title: "Case4",
      canonical_path: "/tmp/Case4.md",
      body_json: {},
      body_text: "Body",
      content_hash: null,
      slug: null,
      status: "draft",
      artifact_type: "general",
      visibility: "private",
      version: 1,
      sync_status: "synced",
      lifecycle: "local-only",
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
      local_updated_at: Date.now(),
    })

    getById.mockResolvedValue({
      id: writingId,
      localPresent: true,
      cloudPresent: false,
      cloudAccountId: null,
      syncStatus: "local-only",
      title: "Case4-final",
      slug: null,
      status: "draft",
      artifactType: "general",
      visibility: "private",
      version: 1,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      binding: {
        documentId: writingId,
        bindingRootId: crypto.randomUUID(),
        relativePath: "Case4-final.md",
        canonicalPath: "/tmp/Case4-final.md",
        inode: null,
        contentHash: null,
        size: null,
        lastSeenAt: Date.now(),
      },
    } satisfies DocumentCatalogRecord)

    const writing = await getWritingForEdit(writingId)

    expect(writing?.title).toBe("Case4-final")
    expect(writing?.canonical_path).toBe("/tmp/Case4-final.md")
    expect(writing?.body_text).toBe("Body")
  })
})
