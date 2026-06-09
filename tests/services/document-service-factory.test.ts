/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMock: vi.fn(),
  getByCanonicalPathMock: vi.fn(),
  getAllMock: vi.fn(),
  saveMock: vi.fn(),
  enqueueWritingUpsertMock: vi.fn(),
  enqueueWritingDeleteMock: vi.fn(),
  migrateMock: vi.fn(),
  getDesktopSettingsMock: vi.fn(),
  updateDesktopSettingsMock: vi.fn(),
  createDraftMock: vi.fn(),
  saveWritingMock: vi.fn(),
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
    mocks.enqueueWritingUpsertMock.mockReset()
    mocks.enqueueWritingDeleteMock.mockReset()
    mocks.migrateMock.mockReset()
    mocks.getDesktopSettingsMock.mockReset()
    mocks.updateDesktopSettingsMock.mockReset()
    mocks.createDraftMock.mockReset()
    mocks.saveWritingMock.mockReset()
    mocks.openWritingMock.mockReset()
    mocks.exportWritingMock.mockReset()
    mocks.joinMock.mockReset()

    mocks.joinMock.mockImplementation(async (...parts: string[]) => parts.join("/"))
    mocks.getDesktopSettingsMock.mockResolvedValue({ data: { writingsDir: "/tmp/documents/Odessay" }, error: null })
    mocks.updateDesktopSettingsMock.mockResolvedValue({ data: { writingsDir: "/tmp/documents/Odessay" }, error: null })
    mocks.getMock.mockResolvedValue(null)
    mocks.getByCanonicalPathMock.mockResolvedValue(null)
    mocks.getAllMock.mockResolvedValue([])
    mocks.saveMock.mockResolvedValue(undefined)
    mocks.enqueueWritingUpsertMock.mockResolvedValue(undefined)
    mocks.enqueueWritingDeleteMock.mockResolvedValue(undefined)
    mocks.createDraftMock.mockResolvedValue({
      data: {
        path: "/tmp/documents/Odessay/untitled.md",
        writing: {
          id: "/tmp/documents/Odessay/untitled.md",
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
        id: "/tmp/documents/Odessay/untitled.md",
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

  it("moves automatic storage away from macOS protected Downloads", async () => {
    mocks.getDesktopSettingsMock.mockResolvedValue({
      data: { writingsDir: "/Users/hugo/Downloads/Odessay" },
      error: null,
    })

    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
    await createDesktopDraft({ title: "Internal" })

    expect(mocks.updateDesktopSettingsMock).toHaveBeenCalledWith({
      writingsDir: "/tmp/app-data/Writings",
    })
  })

  it("re-homes protected canonical paths without reading the protected folder", async () => {
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
    mocks.createDraftMock.mockResolvedValueOnce({
      data: {
        path: "/tmp/app-data/Writings/protected.md",
        writing: {},
      },
      error: null,
    })

    const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
    await createDesktopDraft({ title: "After repair" })

    expect(mocks.openWritingMock).not.toHaveBeenCalledWith("/Users/hugo/Downloads/Protected.md")
    expect(mocks.saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "writing-protected",
        canonical_path: "/tmp/app-data/Writings/protected.md",
      }),
    )
  })

  it("does not directly open protected macOS paths without a local mapping", async () => {
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const service = await getDocumentService()

    const result = await service.openWriting("/Users/hugo/Downloads/old.md")

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("NOT_FOUND")
    expect(mocks.openWritingMock).not.toHaveBeenCalledWith("/Users/hugo/Downloads/old.md")
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
  })
})
