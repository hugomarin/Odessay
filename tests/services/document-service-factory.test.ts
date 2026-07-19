/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  desktop: true,
  catalogGet: vi.fn(),
  catalogList: vi.fn(async () => []),
  catalogResolve: vi.fn(),
  catalogDetach: vi.fn(),
  openFile: vi.fn(),
  createDraft: vi.fn(),
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  exportFile: vi.fn(),
  workspaceSync: vi.fn(),
  dualWrite: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => mocks.desktop,
}))
vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: async () => "/config",
  appDataDir: async () => "/data",
  join: async (...parts: string[]) => parts.join("/"),
}))
vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class {
    getById = mocks.catalogGet
    list = mocks.catalogList
    resolvePath = mocks.catalogResolve
    detachLocalFile = mocks.catalogDetach
    commitDualWrite = (input: unknown) => mocks.dualWrite("/config/desktop-index.sqlite3", input)
  },
}))
vi.mock("@/lib/services/desktop/filesystem-document-service", () => ({
  FilesystemDocumentService: class {
    openWriting = mocks.openFile
    createDraft = mocks.createDraft
    saveWriting = mocks.saveFile
    deleteWriting = mocks.deleteFile
    renameWriting = mocks.renameFile
    exportWriting = mocks.exportFile
  },
}))
vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriWorkspaceSync: mocks.workspaceSync,
  tauriCatalogDualWrite: mocks.dualWrite,
}))
vi.mock("@/lib/services/web-document-service", () => ({
  webDocumentService: { listWritings: vi.fn() },
}))

const id = "11111111-1111-4111-8111-111111111111"
const path = "/docs/Letter.md"
const catalogRecord = {
  id,
  localPresent: true,
  cloudPresent: false,
  cloudAccountId: null,
  syncStatus: "local-only",
  title: "Letter",
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
    relativePath: "Letter.md",
    canonicalPath: path,
    inode: 1,
    contentHash: "blake3:a",
    size: 5,
    lastSeenAt: 2,
  },
}
const writing = {
  id,
  authorId: null,
  title: "Letter",
  content: {
    richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
    markdown: null,
    plainText: "Hello",
    canonicalSource: "rich-text" as const,
  },
  slug: null,
  status: "draft" as const,
  artifactType: "general" as const,
  visibility: "private" as const,
  parentId: null,
  correspondenceId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("desktop document service after compatibility retirement", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.desktop = true
    mocks.catalogGet.mockResolvedValue(catalogRecord)
    mocks.openFile.mockResolvedValue({
      data: { ...writing, id: path, content: { ...writing.content, markdown: "Hello", richText: null } },
      error: null,
    })
    mocks.saveFile.mockResolvedValue({ data: writing, error: null })
    mocks.deleteFile.mockResolvedValue({
      data: { ...writing, deletedAt: "2026-01-02T00:00:00.000Z" },
      error: null,
    })
    mocks.createDraft.mockResolvedValue({ data: { path, writing: { ...writing, id: path } }, error: null })
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/docs", bindingRootId: "root-1", selectedPaths: ["Letter.md"],
      files: [{ id, path, relativePath: "Letter.md", inode: 1, contentHash: "blake3:a", size: 5, modifiedAt: 2 }],
    })
  })

  it("opens UUIDs only through the SQLite binding and hydrates canonical Markdown", async () => {
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).openWriting(id)

    expect(result.error).toBeNull()
    expect(result.data?.id).toBe(id)
    expect(mocks.catalogGet).toHaveBeenCalledWith(id)
    expect(mocks.openFile).toHaveBeenCalledWith(path)
  })

  it("does not treat a path or unknown UUID as identity", async () => {
    mocks.catalogGet.mockResolvedValue(null)
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).openWriting(path)

    expect(result.error?.code).toBe("NOT_FOUND")
    expect(mocks.openFile).not.toHaveBeenCalled()
  })

  it("persists markdown, then manifest, then SQLite mutation", async () => {
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).saveWriting({ writing })

    expect(result.error).toBeNull()
    expect(mocks.saveFile.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspaceSync.mock.invocationCallOrder[0])
    expect(mocks.workspaceSync.mock.invocationCallOrder[0]).toBeLessThan(mocks.dualWrite.mock.invocationCallOrder[0])
    expect(mocks.dualWrite).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3",
      expect.objectContaining({
        document: expect.objectContaining({ id }),
        mutation: expect.objectContaining({ operation: "upsert" }),
      }),
    )
  })

  it("removes the local markdown and queues the confirmed cloud archive", async () => {
    mocks.catalogGet.mockResolvedValue({ ...catalogRecord, cloudPresent: true, cloudAccountId: "acct-1" })
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).deleteWriting({
      writingId: id,
      version: 1,
      updatedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(mocks.dualWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        document: expect.objectContaining({ localPresent: false, deletedAt: "2026-01-02T00:00:00.000Z" }),
        binding: null,
        mutation: expect.objectContaining({ operation: "delete" }),
      }),
    )
    expect(mocks.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ writingId: path }))
  })

  it("deletes local-only documents without enqueueing a cloud mutation", async () => {
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).deleteWriting({
      writingId: id,
      version: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1)
    expect(mocks.dualWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mutation: null }),
    )
  })

  it("archives cloud-only documents without touching the filesystem", async () => {
    mocks.catalogGet.mockResolvedValue({
      ...catalogRecord,
      localPresent: false,
      cloudPresent: true,
      cloudAccountId: "acct-1",
      binding: null,
    })
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).deleteWriting({
      writingId: id,
      version: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
      deletedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(mocks.deleteFile).not.toHaveBeenCalled()
    expect(mocks.dualWrite).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ mutation: expect.objectContaining({ operation: "delete" }) }),
    )
  })
})
