import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LocalWriting } from "@/lib/local-db/schema"
import { migrateIndexedDbToFilesystem } from "@/lib/migrations/indexeddb-to-filesystem"

const {
  getAllMock,
  saveMock,
  createDraftMock,
  saveWritingMock,
} = vi.hoisted(() => ({
  getAllMock: vi.fn(),
  saveMock: vi.fn(),
  createDraftMock: vi.fn(),
  saveWritingMock: vi.fn(),
}))

vi.mock("@/lib/local-db", () => ({
  localDB: {
    writings: {
      getAll: getAllMock,
      save: saveMock,
    },
  },
}))

describe("desktop save path migration", () => {
  beforeEach(() => {
    getAllMock.mockReset()
    saveMock.mockReset()
    createDraftMock.mockReset()
    saveWritingMock.mockReset()
  })

  it("materializes IndexedDB-only writings into canonical .md files exactly once", async () => {
    const legacyWriting: LocalWriting = {
      id: "writing-1",
      author_id: null,
      title: "Migrated draft",
      body_json: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello desktop" }] }],
      },
      body_text: "Hello desktop",
      slug: "migrated-draft",
      status: "draft",
      visibility: "private",
      parent_id: null,
      correspondence_id: null,
      version: 3,
      sync_status: "pending",
      lifecycle: "local-only",
      deleted_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-03T00:00:00.000Z",
      local_updated_at: Date.now(),
    }

    const alreadyMigrated: LocalWriting = {
      ...legacyWriting,
      id: "writing-2",
      canonical_path: "/docs/already.md",
    }

    getAllMock.mockResolvedValue([legacyWriting, alreadyMigrated])
    createDraftMock.mockResolvedValue({
      data: {
        path: "/docs/migrated-draft.md",
        writing: {
          id: "/docs/migrated-draft.md",
          title: "Migrated draft",
          content: { markdown: "", richText: null, plainText: "", canonicalSource: "markdown" },
          authorId: null,
          slug: null,
          status: "draft",
          visibility: "private",
          parentId: null,
          correspondenceId: null,
          version: 1,
          deletedAt: null,
          createdAt: legacyWriting.created_at,
          updatedAt: legacyWriting.updated_at,
        },
        error: null,
      },
      error: null,
    })
    saveWritingMock.mockResolvedValue({ data: {}, error: null })

    const result = await migrateIndexedDbToFilesystem({
      filesystem: {
        createDraft: createDraftMock,
        saveWriting: saveWritingMock,
      } as never,
    })

    expect(result).toEqual({ migratedCount: 1, skippedCount: 1 })
    expect(createDraftMock).toHaveBeenCalledTimes(1)
    expect(saveWritingMock).toHaveBeenCalledTimes(1)
    expect(saveWritingMock.mock.calls[0]?.[0].writing.content.markdown).toContain("id: writing-1")
    expect(saveWritingMock.mock.calls[0]?.[0].writing.content.markdown).toContain("Hello desktop")
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "writing-1",
        canonical_path: "/docs/migrated-draft.md",
      }),
    )
  })
})
