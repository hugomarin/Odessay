/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"

const mocks = vi.hoisted(() => ({
  desktop: true,
  catalogGet: vi.fn(),
  catalogList: vi.fn<() => Promise<DocumentCatalogRecord[]>>(async () => []),
  authGetSession: vi.fn(),
  catalogResolve: vi.fn(),
  catalogDetach: vi.fn(),
  applyReconcile: vi.fn(),
  openFile: vi.fn(),
  createDraft: vi.fn(),
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  exportFile: vi.fn(),
  workspaceSync: vi.fn(),
  dualWrite: vi.fn(),
  bulkDualWrite: vi.fn(),
  tauriOpen: vi.fn(),
  tauriWrite: vi.fn(),
  tauriRelocate: vi.fn(),
  getBindingRoots: vi.fn(async () => [] as unknown[]),
  getDesktopSettings: vi.fn(async () => ({ data: { workspaces: [] }, error: null })),
  upsertBindingRoot: vi.fn(),
  refreshReconcilerRoots: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => mocks.desktop,
}))
vi.mock("@/lib/services/auth-service-factory", () => ({
  getAuthService: () => ({ getSession: mocks.authGetSession }),
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
    applyReconcileTransaction = mocks.applyReconcile
    commitDualWrite = (input: unknown) => mocks.dualWrite("/config/desktop-index.sqlite3", input)
    commitBulkDualWrite = (inputs: unknown[]) => mocks.bulkDualWrite(inputs)
  },
}))
vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    getBindingRoots = mocks.getBindingRoots
    getDesktopSettings = mocks.getDesktopSettings
    upsertBindingRoot = mocks.upsertBindingRoot
  },
}))
vi.mock("@/lib/services/desktop/desktop-workspace-reconciler", () => ({
  refreshWorkspaceReconcilerRoots: mocks.refreshReconcilerRoots,
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
  tauriOpenFile: mocks.tauriOpen,
  tauriWriteFile: mocks.tauriWrite,
  tauriRelocateFile: mocks.tauriRelocate,
}))
vi.mock("@/lib/services/web-document-service", () => ({
  webDocumentService: { listWritings: vi.fn() },
}))

const id = "11111111-1111-4111-8111-111111111111"
const path = "/docs/Letter.md"
const catalogRecord: DocumentCatalogRecord = {
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
    mocks.authGetSession.mockResolvedValue({
      data: {
        status: "authenticated",
        user: { id: "account-1", email: null, pendingEmail: null, emailConfirmedAt: null, displayName: null, username: null },
      },
      error: null,
    })
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

  describe("createDesktopDraft lifecycle (ODE-406)", () => {
    it("has zero durable effects until called with real content, then commits one ordered transition", async () => {
      expect(mocks.createDraft).not.toHaveBeenCalled()
      expect(mocks.saveFile).not.toHaveBeenCalled()
      expect(mocks.workspaceSync).not.toHaveBeenCalled()
      expect(mocks.dualWrite).not.toHaveBeenCalled()

      const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
      const result = await createDesktopDraft({
        writingId: id,
        title: "Untitled",
        initialBodyText: "First words",
        initialBodyJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "First words" }] }],
        },
      })

      expect(result.error).toBeNull()
      expect(mocks.createDraft).toHaveBeenCalledTimes(1)
      expect(mocks.saveFile).toHaveBeenCalledTimes(1)
      expect(mocks.workspaceSync).toHaveBeenCalledTimes(1)
      expect(mocks.dualWrite).toHaveBeenCalledTimes(1)
      expect(mocks.dualWrite).toHaveBeenCalledWith(
        "/config/desktop-index.sqlite3",
        expect.objectContaining({
          document: expect.objectContaining({ id, localPresent: true, syncStatus: "pending" }),
          mutation: expect.objectContaining({ operation: "upsert", status: "pending" }),
        }),
      )
      expect(mocks.saveFile.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.workspaceSync.mock.invocationCallOrder[0])
      expect(mocks.workspaceSync.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.dualWrite.mock.invocationCallOrder[0])
    })
  })

  describe("relocateDesktopWriting (ODE-402)", () => {
    const managedRecord = {
      ...catalogRecord,
      binding: {
        ...catalogRecord.binding,
        bindingRootId: "managed-root",
        relativePath: "Letter.md",
        canonicalPath: "/managed/Letter.md",
      },
    }

    beforeEach(() => {
      mocks.catalogGet.mockResolvedValue(managedRecord)
      mocks.tauriRelocate.mockResolvedValue("/chosen/Renamed.md")
      mocks.getBindingRoots.mockResolvedValue([
        {
          id: "managed-root", rootPath: "/managed", kind: "managed",
          visibleAsWorkspace: false, selectedPaths: [], consentedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ])
      mocks.workspaceSync.mockImplementation(async (rootPath: string) => ({
        rootPath,
        bindingRootId: rootPath === "/managed" ? "managed-root" : "dest-root",
        selectedPaths: rootPath === "/managed" ? [] : ["Renamed.md"],
        files: rootPath === "/managed"
          ? []
          : [{
              id, path: "/chosen/Renamed.md", relativePath: "Renamed.md",
              inode: 7, contentHash: "blake3:b", size: 8, modifiedAt: 9,
            }],
      }))
    })

    it("moves the file, binds the SAME UUID at the destination and enqueues sync in one transaction", async () => {
      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "# Letter\n\nHello\n")

      expect(result).toEqual({ status: "relocated", path: "/chosen/Renamed.md" })

      // Content commit to the CURRENT canonical file, then the physical rename.
      expect(mocks.tauriWrite).toHaveBeenCalledWith("/managed/Letter.md", "# Letter\n\nHello\n")
      expect(mocks.tauriRelocate).toHaveBeenCalledWith("/managed/Letter.md", "/chosen/Renamed.md")
      expect(mocks.tauriWrite.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.tauriRelocate.mock.invocationCallOrder[0])

      // Destination ledger binds the moved file to the SAME UUID with a scope
      // limited to exactly that file (a new root never indexes the folder).
      expect(mocks.workspaceSync).toHaveBeenCalledWith("/chosen", ["Renamed.md"], { "Renamed.md": id })

      // SQLite binding replacement + sync enqueue in one dual-write transaction.
      expect(mocks.dualWrite).toHaveBeenCalledWith(
        "/config/desktop-index.sqlite3",
        expect.objectContaining({
          document: expect.objectContaining({ id, localPresent: true, title: "Renamed" }),
          binding: expect.objectContaining({
            canonicalPath: "/chosen/Renamed.md",
            bindingRootId: "dest-root",
            visibleAsWorkspace: false,
          }),
          mutation: expect.objectContaining({ operation: "upsert" }),
        }),
      )

      // Origin ledger drop after SQLite moved on (manifest rewritten without the file).
      expect(mocks.workspaceSync).toHaveBeenCalledWith("/managed")
      const destSyncOrder = mocks.workspaceSync.mock.invocationCallOrder[0]
      expect(mocks.tauriRelocate.mock.invocationCallOrder[0]).toBeLessThan(destSyncOrder)
      expect(destSyncOrder).toBeLessThan(mocks.dualWrite.mock.invocationCallOrder[0])

      // The chosen folder becomes an external BindingRoot: consented, scoped to
      // the file, never a visible Workspace by default; the reconciler watches it.
      expect(mocks.upsertBindingRoot).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "dest-root", rootPath: "/chosen", kind: "external",
          visibleAsWorkspace: false, selectedPaths: ["Renamed.md"],
        }),
      )
      expect(mocks.upsertBindingRoot.mock.calls[0][0].consentedAt).toBeTruthy()
      expect(mocks.refreshReconcilerRoots).toHaveBeenCalled()
    })

    it("adopts the collision-suffixed path resolved by the physical move", async () => {
      mocks.tauriRelocate.mockResolvedValue("/chosen/Renamed 2.md")
      mocks.workspaceSync.mockImplementation(async (rootPath: string) => ({
        rootPath,
        bindingRootId: rootPath === "/managed" ? "managed-root" : "dest-root",
        selectedPaths: rootPath === "/managed" ? [] : ["Renamed 2.md"],
        files: rootPath === "/managed"
          ? []
          : [{
              id, path: "/chosen/Renamed 2.md", relativePath: "Renamed 2.md",
              inode: 7, contentHash: "blake3:b", size: 8, modifiedAt: 9,
            }],
      }))

      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "Hello\n")

      expect(result).toEqual({ status: "relocated", path: "/chosen/Renamed 2.md" })
      expect(mocks.workspaceSync).toHaveBeenCalledWith("/chosen", ["Renamed 2.md"], { "Renamed 2.md": id })
      expect(mocks.dualWrite).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          document: expect.objectContaining({ title: "Renamed 2" }),
        }),
      )
    })

    it("extends a narrowed selection of an existing destination root with the chosen file", async () => {
      mocks.getBindingRoots.mockResolvedValue([
        {
          id: "managed-root", rootPath: "/managed", kind: "managed",
          visibleAsWorkspace: false, selectedPaths: [], consentedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "dest-root", rootPath: "/chosen", kind: "external",
          visibleAsWorkspace: false, selectedPaths: ["Other.md"],
          consentedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
        },
      ])
      mocks.workspaceSync.mockImplementation(async (rootPath: string) => ({
        rootPath,
        bindingRootId: rootPath === "/managed" ? "managed-root" : "dest-root",
        selectedPaths: rootPath === "/managed" ? [] : ["Other.md", "Renamed.md"],
        files: rootPath === "/managed"
          ? []
          : [{
              id, path: "/chosen/Renamed.md", relativePath: "Renamed.md",
              inode: 7, contentHash: "blake3:b", size: 8, modifiedAt: 9,
            }],
      }))

      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "Hello\n")

      expect(result.status).toBe("relocated")
      expect(mocks.workspaceSync).toHaveBeenCalledWith(
        "/chosen",
        ["Other.md", "Renamed.md"],
        { "Renamed.md": id },
      )
      // Existing root: no new registration, only the extended durable scope.
      expect(mocks.refreshReconcilerRoots).not.toHaveBeenCalled()
      expect(mocks.upsertBindingRoot).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dest-root", selectedPaths: ["Other.md", "Renamed.md"] }),
      )
    })

    it("reports a recoverable failure and touches nothing else when the physical move fails", async () => {
      mocks.tauriRelocate.mockRejectedValue(new Error("relocate_file verify: copied content mismatch; original preserved"))

      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "Hello\n")

      expect(result).toEqual({
        status: "failed",
        message: "relocate_file verify: copied content mismatch; original preserved",
      })
      expect(mocks.dualWrite).not.toHaveBeenCalled()
      expect(mocks.upsertBindingRoot).not.toHaveBeenCalled()
      expect(mocks.workspaceSync).not.toHaveBeenCalled()
    })

    it("reports a recoverable failure for a UUID without local binding (never a draft)", async () => {
      mocks.catalogGet.mockResolvedValue(null)

      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "Hello\n")

      expect(result.status).toBe("failed")
      expect(mocks.tauriRelocate).not.toHaveBeenCalled()
      expect(mocks.tauriWrite).not.toHaveBeenCalled()
      expect(mocks.dualWrite).not.toHaveBeenCalled()
    })

    it("fails without adopting a second identity when the destination manifest binds another UUID", async () => {
      mocks.workspaceSync.mockImplementation(async (rootPath: string) => ({
        rootPath,
        bindingRootId: "dest-root",
        selectedPaths: ["Renamed.md"],
        files: [{
          id: "22222222-2222-4222-8222-222222222222", path: "/chosen/Renamed.md",
          relativePath: "Renamed.md", inode: 7, contentHash: "blake3:b", size: 8, modifiedAt: 9,
        }],
      }))

      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "Hello\n")

      expect(result.status).toBe("failed")
      expect(mocks.dualWrite).not.toHaveBeenCalled()
    })
  })

  describe("relocateDesktopWritingByCanonicalPath (watcher-observed move)", () => {
    it("projects the manifest's verdict into SQLite via the reconcile transaction", async () => {
      mocks.catalogResolve.mockResolvedValue({ kind: "resolved", record: catalogRecord })
      mocks.workspaceSync.mockResolvedValue({
        rootPath: "/docs", bindingRootId: "root-1", selectedPaths: [],
        files: [{
          id, path: "/docs/Sub/Letter.md", relativePath: "Sub/Letter.md",
          inode: 1, contentHash: "blake3:a", size: 5, modifiedAt: 10,
        }],
      })

      const { relocateDesktopWritingByCanonicalPath } = await import("@/lib/services/document-service-factory")
      await relocateDesktopWritingByCanonicalPath("/docs/Letter.md", "/docs/Sub/Letter.md")

      expect(mocks.applyReconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingRootId: "root-1",
          rootPath: "/docs",
          upserts: [expect.objectContaining({
            documentId: id,
            canonicalPath: "/docs/Sub/Letter.md",
            relativePath: "Sub/Letter.md",
          })],
          detached: [],
        }),
      )
    })

    it("never auto-chooses identity when the manifest resolves a different UUID", async () => {
      mocks.catalogResolve.mockResolvedValue({ kind: "resolved", record: catalogRecord })
      mocks.workspaceSync.mockResolvedValue({
        rootPath: "/docs", bindingRootId: "root-1", selectedPaths: [],
        files: [{
          id: "33333333-3333-4333-8333-333333333333", path: "/docs/Sub/Letter.md",
          relativePath: "Sub/Letter.md", inode: 1, contentHash: "blake3:a", size: 5, modifiedAt: 10,
        }],
      })

      const { relocateDesktopWritingByCanonicalPath } = await import("@/lib/services/document-service-factory")
      await relocateDesktopWritingByCanonicalPath("/docs/Letter.md", "/docs/Sub/Letter.md")

      expect(mocks.applyReconcile).not.toHaveBeenCalled()
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

  it("returns only archived catalog rows and paginates after filtering", async () => {
    const archivedAt = "2026-01-02T00:00:00.000Z"
    const archivedRecord = {
      ...catalogRecord,
      id: "22222222-2222-4222-8222-222222222222",
      title: "Archived letter",
      deletedAt: archivedAt,
    }
    const secondArchivedRecord = {
      ...archivedRecord,
      id: "33333333-3333-4333-8333-333333333333",
      title: "Second archived letter",
    }
    mocks.catalogList.mockResolvedValue([
      catalogRecord,
      archivedRecord,
      secondArchivedRecord,
    ])

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).listWritings({
      includeDeleted: true,
      archivedOnly: true,
      limit: 1,
      offset: 1,
    })

    expect(mocks.catalogList).toHaveBeenCalledWith({
      cloudAccountId: "account-1",
      includeDeleted: true,
      limit: 5000,
    })
    expect(result.error).toBeNull()
    expect(result.data).toEqual([
      expect.objectContaining({
        id: secondArchivedRecord.id,
        deletedAt: archivedAt,
        archiveState: "archived",
      }),
    ])
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

  it("updates desktop metadata without rewriting the canonical markdown", async () => {
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).updateWritingMetadata({
      writingId: id,
      status: "done",
      artifactType: "skill",
      version: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(mocks.saveFile).not.toHaveBeenCalled()
    expect(mocks.tauriWrite).not.toHaveBeenCalled()
    expect(mocks.workspaceSync).not.toHaveBeenCalled()
    expect(mocks.bulkDualWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        document: expect.objectContaining({
          id,
          status: "done",
          artifactType: "skill",
          version: 2,
        }),
        binding: expect.objectContaining({ canonicalPath: path, contentHash: "blake3:a" }),
        mutation: expect.objectContaining({
          operation: "upsert",
          payloadJson: expect.stringContaining('"mutationKind":"metadata"'),
        }),
      }),
    ])
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
