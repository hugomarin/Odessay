/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMock: vi.fn(),
  getByCanonicalPathMock: vi.fn(),
  getAllMock: vi.fn(),
  saveMock: vi.fn(),
  detachLocalFileMock: vi.fn(),
  enqueueWritingUpsertMock: vi.fn(),
  enqueueWritingDeleteMock: vi.fn(),
  migrateMock: vi.fn(),
  getDesktopSettingsMock: vi.fn(),
  updateDesktopSettingsMock: vi.fn(),
  createDraftMock: vi.fn(),
  saveWritingMock: vi.fn(),
  deleteWritingMock: vi.fn(),
  openWritingMock: vi.fn(),
  exportWritingMock: vi.fn(),
  joinMock: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/local-db", () => ({
  localDB: {
    writings: {
      get: mocks.getMock,
      getByCanonicalPath: mocks.getByCanonicalPathMock,
      getAll: mocks.getAllMock,
      save: mocks.saveMock,
      detachLocalFile: mocks.detachLocalFileMock,
    },
  },
}))

vi.mock("@/lib/sync/queue", () => ({
  enqueueWritingUpsert: mocks.enqueueWritingUpsertMock,
  enqueueWritingDelete: mocks.enqueueWritingDeleteMock,
}))

vi.mock("@/lib/migrations/indexeddb-to-filesystem", () => ({
  migrateIndexedDbToFilesystem: mocks.migrateMock,
}))

vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    async getDesktopSettings() {
      return mocks.getDesktopSettingsMock()
    }
    async updateDesktopSettings(patch: unknown) {
      return mocks.updateDesktopSettingsMock(patch)
    }
  },
}))

vi.mock("@/lib/services/desktop/local-index-service", () => ({
  LocalIndexService: class {},
}))

vi.mock("@/lib/services/desktop/filesystem-document-service", () => ({
  FilesystemDocumentService: class {
    createDraft = mocks.createDraftMock
    saveWriting = mocks.saveWritingMock
    deleteWriting = mocks.deleteWritingMock
    openWriting = mocks.openWritingMock
    exportWriting = mocks.exportWritingMock
  },
}))

vi.mock("@/lib/services/web-document-service", () => ({
  webDocumentService: {
    listWritingCollections: vi.fn(),
    setWritingCollections: vi.fn(),
  },
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(async () => "/tmp/config"),
  appDataDir: vi.fn(async () => "/tmp/app-data"),
  join: mocks.joinMock,
}))

describe("document-service-factory", () => {
  beforeEach(() => {
    vi.resetModules()

    mocks.getMock.mockReset()
    mocks.getByCanonicalPathMock.mockReset()
    mocks.getAllMock.mockReset()
    mocks.saveMock.mockReset()
    mocks.detachLocalFileMock.mockReset()
    mocks.enqueueWritingUpsertMock.mockReset()
    mocks.enqueueWritingDeleteMock.mockReset()
    mocks.migrateMock.mockReset()
    mocks.getDesktopSettingsMock.mockReset()
    mocks.updateDesktopSettingsMock.mockReset()
    mocks.createDraftMock.mockReset()
    mocks.saveWritingMock.mockReset()
    mocks.deleteWritingMock.mockReset()
    mocks.openWritingMock.mockReset()
    mocks.exportWritingMock.mockReset()
    mocks.joinMock.mockReset()

    mocks.joinMock.mockImplementation(async (...parts: string[]) => parts.join("/"))
    mocks.getDesktopSettingsMock.mockResolvedValue({ data: { writingsDir: "/tmp/documents/Artifact Studio" }, error: null })
    mocks.updateDesktopSettingsMock.mockResolvedValue({ data: { writingsDir: "/tmp/documents/Artifact Studio" }, error: null })
    mocks.getMock.mockResolvedValue(null)
    mocks.getByCanonicalPathMock.mockResolvedValue(null)
    mocks.getAllMock.mockResolvedValue([])
    mocks.saveMock.mockResolvedValue(undefined)
    mocks.detachLocalFileMock.mockResolvedValue(undefined)
    mocks.enqueueWritingUpsertMock.mockResolvedValue(undefined)
    mocks.enqueueWritingDeleteMock.mockResolvedValue(undefined)
    mocks.createDraftMock.mockResolvedValue({
      data: {
        path: "/tmp/documents/Artifact Studio/untitled.md",
        writing: {
          id: "/tmp/documents/Artifact Studio/untitled.md",
          authorId: null,
          title: "Untitled writing",
          content: { markdown: "", richText: null, plainText: "", canonicalSource: "markdown" },
          slug: null,
          status: "draft",
          visibility: "private",
          parentId: null,
          correspondenceId: null,
          version: 1,
          deletedAt: null,
          createdAt: "2026-06-04T00:00:00.000Z",
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
      },
      error: null,
    })
    mocks.saveWritingMock.mockResolvedValue({
      data: {
        id: "/tmp/documents/Artifact Studio/untitled.md",
        authorId: null,
        title: "Untitled writing",
        content: { markdown: "# Untitled writing", richText: null, plainText: "Untitled writing", canonicalSource: "markdown" },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      error: null,
    })
    mocks.deleteWritingMock.mockResolvedValue({
      data: {
        id: "/tmp/documents/Artifact Studio/untitled.md",
        authorId: null,
        title: "Untitled writing",
        content: { markdown: "# Untitled writing", richText: null, plainText: "Untitled writing", canonicalSource: "markdown" },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: "2026-06-04T00:00:00.000Z",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      error: null,
    })
    mocks.migrateMock.mockResolvedValue({ migratedCount: 0, skippedCount: 0 })
  })

  it("uses app data storage when no desktop writings directory is configured", async () => {
    mocks.getDesktopSettingsMock.mockResolvedValue({ data: {}, error: null })

    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
    await createDesktopDraft({ title: "Internal" })

    expect(mocks.updateDesktopSettingsMock).toHaveBeenCalledWith({
      writingsDir: "/tmp/app-data/Writings",
    })
  })

  it("keeps configured macOS protected folders as the draft location", async () => {
    mocks.getDesktopSettingsMock.mockResolvedValue({
      data: { writingsDir: "/Users/hugo/Downloads/Artifact Studio" },
      error: null,
    })

    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
    await createDesktopDraft({ title: "Internal" })

    expect(mocks.updateDesktopSettingsMock).not.toHaveBeenCalled()
  })

  it("leaves protected canonical paths in place during desktop migration", async () => {
    mocks.getAllMock.mockResolvedValue([
      {
        id: "writing-protected",
        author_id: null,
        title: "Protected",
        canonical_path: "/Users/hugo/Downloads/Protected.md",
        body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Cached body" }] }] },
        body_text: "Cached body",
        slug: null,
        status: "draft",
        visibility: "private",
        parent_id: null,
        correspondence_id: null,
        version: 1,
        sync_status: "synced",
        lifecycle: "local-only",
        deleted_at: null,
        created_at: "2026-06-04T00:00:00.000Z",
        updated_at: "2026-06-04T00:00:00.000Z",
        local_updated_at: 1,
      },
    ])

    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
    await createDesktopDraft({ title: "After repair" })

    expect(mocks.getAllMock).not.toHaveBeenCalled()
    expect(mocks.openWritingMock).not.toHaveBeenCalledWith("/Users/hugo/Downloads/Protected.md")
    expect(mocks.saveMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "writing-protected" }),
    )
  })

  it("opens protected macOS paths directly when there is no local mapping", async () => {
    mocks.openWritingMock.mockResolvedValueOnce({
      data: {
        id: "/Users/hugo/Downloads/old.md",
        authorId: null,
        title: "Old",
        content: {
          markdown: "# Old\n\nIn place",
          richText: null,
          plainText: "In place",
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      error: null,
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const service = await getDocumentService()

    const result = await service.openWriting("/Users/hugo/Downloads/old.md")

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      content: { canonicalSource: "markdown" },
    })
    expect(result.data?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(mocks.openWritingMock).toHaveBeenCalledWith("/Users/hugo/Downloads/old.md")
    expect(mocks.saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical_path: "/Users/hugo/Downloads/old.md",
      }),
    )
  })

  it("retries migration after an initial failure instead of caching a rejected promise forever", async () => {
    mocks.migrateMock
      .mockRejectedValueOnce(new Error("migration failed"))
      .mockResolvedValueOnce({ migratedCount: 0, skippedCount: 0 })

    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")

    const first = await createDesktopDraft({ title: "Retry me" })
    expect(first.error?.message).toContain("migration failed")

    const second = await createDesktopDraft({ title: "Retry me" })
    expect(second.error).toBeNull()
    expect(mocks.migrateMock).toHaveBeenCalledTimes(2)
  })

  it("coalesces desktop save fan-out to a single enqueueWritingUpsert call per draft save", async () => {
    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")

    const result = await createDesktopDraft({
      title: "One enqueue only",
      initialBodyText: "One enqueue only",
      initialBodyJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "One enqueue only" }] }],
      },
    })

    expect(result.error).toBeNull()
    expect(mocks.enqueueWritingUpsertMock).toHaveBeenCalledTimes(1)
    expect(mocks.saveWritingMock).toHaveBeenCalledTimes(1)
    expect(mocks.saveWritingMock.mock.calls[0]?.[0].writing.content.markdown).not.toContain("---")
    expect(mocks.saveWritingMock.mock.calls[0]?.[0].writing.content.markdown).not.toContain("id:")
  })

  it("detaches a watcher-deleted desktop file without enqueueing a cloud delete", async () => {
    mocks.getByCanonicalPathMock.mockResolvedValueOnce({
      id: "writing-cloud",
      author_id: "user-1",
      title: "Cloud backed",
      canonical_path: "/tmp/documents/Artifact Studio/cloud-backed.md",
      body_json: { type: "doc", content: [] },
      body_text: "Cloud backed",
      slug: null,
      status: "draft",
      visibility: "private",
      parent_id: null,
      correspondence_id: null,
      version: 3,
      sync_status: "synced",
      lifecycle: "server-confirmed",
      deleted_at: null,
      created_at: "2026-06-04T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
      local_updated_at: 1,
    })

    const { markDesktopWritingDeletedByCanonicalPath } = await import("@/lib/services/document-service-factory")
    await markDesktopWritingDeletedByCanonicalPath("/tmp/documents/Artifact Studio/cloud-backed.md")

    expect(mocks.detachLocalFileMock).toHaveBeenCalledWith("writing-cloud")
    expect(mocks.enqueueWritingDeleteMock).not.toHaveBeenCalled()
  })

  it("desktop deleteWriting removes the local file binding without deleting the cloud record", async () => {
    const beforeDelete = {
      id: "writing-cloud",
      author_id: "user-1",
      title: "Cloud backed",
      canonical_path: "/tmp/documents/Artifact Studio/cloud-backed.md",
      body_json: { type: "doc", content: [] },
      body_text: "Cloud backed",
      slug: null,
      status: "draft" as const,
      visibility: "private" as const,
      parent_id: null,
      correspondence_id: null,
      version: 3,
      sync_status: "synced" as const,
      lifecycle: "server-confirmed" as const,
      deleted_at: null,
      created_at: "2026-06-04T00:00:00.000Z",
      updated_at: "2026-06-04T00:00:00.000Z",
      local_updated_at: 1,
    }
    const afterDelete = { ...beforeDelete, canonical_path: null }

    mocks.getMock
      .mockResolvedValueOnce(beforeDelete)
      .mockResolvedValueOnce(afterDelete)

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const service = await getDocumentService()
    const result = await service.deleteWriting({
      writingId: "writing-cloud",
      version: 4,
      updatedAt: "2026-06-05T00:00:00.000Z",
      deletedAt: "2026-06-05T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(result.data?.deletedAt).toBeNull()
    expect(result.data?.content.canonicalSource).toBe("rich-text")
    expect(mocks.deleteWritingMock).toHaveBeenCalledWith({
      writingId: "/tmp/documents/Artifact Studio/cloud-backed.md",
      version: 4,
      updatedAt: "2026-06-05T00:00:00.000Z",
      deletedAt: "2026-06-05T00:00:00.000Z",
    })
    expect(mocks.detachLocalFileMock).toHaveBeenCalledWith("writing-cloud")
    expect(mocks.enqueueWritingDeleteMock).not.toHaveBeenCalled()
  })

  it("uses IndexedDB metadata instead of legacy file frontmatter when opening desktop markdown", async () => {
    mocks.getMock.mockResolvedValueOnce(null)
    mocks.getByCanonicalPathMock.mockResolvedValueOnce({
      id: "writing-from-index",
      author_id: null,
      title: "Indexed metadata",
      canonical_path: "/tmp/documents/Artifact Studio/legacy.md",
      body_json: { type: "doc", content: [] },
      body_text: "",
      slug: "indexed-slug",
      status: "done",
      visibility: "public",
      parent_id: null,
      correspondence_id: null,
      version: 7,
      sync_status: "synced",
      lifecycle: "server-confirmed",
      deleted_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
      local_updated_at: 1,
    })
    mocks.openWritingMock.mockResolvedValueOnce({
      data: {
        id: "/tmp/documents/Artifact Studio/legacy.md",
        authorId: null,
        title: "File title",
        content: {
          markdown: `---
id: legacy-frontmatter-id
slug: legacy-slug
status: draft
visibility: private
version: 2
---

# File body`,
          richText: null,
          plainText: "File body",
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 2,
        deletedAt: null,
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
      error: null,
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const service = await getDocumentService()
    const result = await service.openWriting("/tmp/documents/Artifact Studio/legacy.md")

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      id: "writing-from-index",
      slug: "indexed-slug",
      status: "done",
      visibility: "public",
      version: 7,
    })
    expect(mocks.saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "writing-from-index",
        slug: "indexed-slug",
        status: "done",
        visibility: "public",
        version: 7,
        body_text: expect.stringContaining("id: legacy-frontmatter-id"),
      }),
    )
  })

  it("opens cloud-only desktop records from body_json without treating the writing id as a file path", async () => {
    mocks.getMock.mockResolvedValueOnce({
      id: "cloud-only-writing",
      author_id: "user-1",
      title: "Cloud only",
      canonical_path: null,
      body_json: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Persisted web body" }] }],
      },
      body_text: "Persisted web body",
      slug: "cloud-only",
      status: "draft",
      visibility: "private",
      parent_id: null,
      correspondence_id: null,
      version: 4,
      sync_status: "synced",
      lifecycle: "server-confirmed",
      deleted_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
      local_updated_at: 1,
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const service = await getDocumentService()
    const result = await service.openWriting("cloud-only-writing")

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      id: "cloud-only-writing",
      title: "Cloud only",
      content: {
        plainText: "Persisted web body",
        canonicalSource: "rich-text",
      },
    })
    expect(mocks.getByCanonicalPathMock).toHaveBeenCalledWith("cloud-only-writing")
    expect(mocks.openWritingMock).not.toHaveBeenCalled()
    expect(mocks.saveMock).not.toHaveBeenCalled()
  })
})
