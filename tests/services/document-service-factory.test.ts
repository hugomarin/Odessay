/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import ts from "typescript"
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
  downloadWriting: vi.fn(),
  exportFile: vi.fn(),
  webExport: vi.fn(),
  workspaceSync: vi.fn(),
  workspaceTouch: vi.fn(),
  dualWrite: vi.fn(),
  bulkDualWrite: vi.fn(),
  tauriOpen: vi.fn(),
  tauriWrite: vi.fn(),
  tauriRelocate: vi.fn(),
  getBindingRoots: vi.fn(async () => [] as unknown[]),
  getDesktopSettings: vi.fn(async () => ({ data: { workspaces: [] }, error: null })),
  upsertBindingRoot: vi.fn(),
  refreshReconcilerRoots: vi.fn(),
  syncFlush: vi.fn(),
  scheduleSyncFlush: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => mocks.desktop,
}))
vi.mock("@/lib/services/auth-service-factory", () => ({
  getAuthService: () => ({ getSession: mocks.authGetSession }),
}))
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({
    flushPending: mocks.syncFlush,
    scheduleFlush: mocks.scheduleSyncFlush,
  }),
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
    getPendingRelocationRepairs = async () => []
    upsertPendingRelocationRepair = async () => undefined
    removePendingRelocationRepair = async () => undefined
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
    downloadWriting = mocks.downloadWriting
    exportWriting = mocks.exportFile
  },
}))
vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriWorkspaceSync: mocks.workspaceSync,
  tauriWorkspaceTouchFile: mocks.workspaceTouch,
  tauriCatalogDualWrite: mocks.dualWrite,
  tauriOpenFile: mocks.tauriOpen,
  tauriWriteFile: mocks.tauriWrite,
  tauriRelocateFile: mocks.tauriRelocate,
}))
vi.mock("@/lib/services/web-document-service", () => ({
  webDocumentService: { listWritings: vi.fn(), exportWriting: mocks.webExport },
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
    mocks.syncFlush.mockResolvedValue({
      data: { processedMutations: 1, failedMutations: [], nextRetryAt: null },
      error: null,
    })
    mocks.scheduleSyncFlush.mockResolvedValue({ data: undefined, error: null })
    mocks.catalogGet.mockResolvedValue(catalogRecord)
    mocks.tauriOpen.mockResolvedValue("# Letter\n\nHello\n")
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
    mocks.renameFile.mockResolvedValue({ data: { ...writing, id: path, title: "Renamed" }, error: null })
    mocks.downloadWriting.mockResolvedValue({
      data: {
        writingId: path,
        format: "pdf" as const,
        fileName: "Letter.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
      error: null,
    })
    mocks.exportFile.mockResolvedValue({
      data: {
        writingId: path,
        format: "pdf" as const,
        fileName: "Letter.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
      error: null,
    })
    mocks.webExport.mockResolvedValue({
      data: null,
      error: { code: "UNAVAILABLE", message: "This artifact has no local copy on this machine" },
    })
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/docs", bindingRootId: "root-1", selectedPaths: ["Letter.md"],
      files: [{ id, path, relativePath: "Letter.md", inode: 1, contentHash: "blake3:a", size: 5, modifiedAt: 2 }],
    })
    // Default to the recoverable outcome so every pre-existing expectation keeps
    // exercising the full reconciliation path; the ODE-459 tests below opt in.
    mocks.workspaceTouch.mockResolvedValue({ status: "needsReconcile", reason: "test default" })
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

  it("waits for cloud acknowledgement before completing a permanent delete", async () => {
    mocks.catalogGet.mockResolvedValue({
      ...catalogRecord,
      localPresent: false,
      cloudPresent: false,
      syncStatus: "deleted",
      deletedAt: "2026-01-02T00:00:00.000Z",
      binding: null,
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).permanentlyDeleteWriting({ writingId: id })

    expect(result.error).toBeNull()
    expect(mocks.dualWrite).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3",
      expect.objectContaining({
        mutation: expect.objectContaining({
          operation: "delete",
          payloadJson: expect.stringContaining("permanent-delete"),
        }),
      }),
    )
    expect(mocks.syncFlush).toHaveBeenCalledTimes(1)
  })

  it("waits for cloud acknowledgement before completing a restore", async () => {
    mocks.catalogGet.mockResolvedValue({
      ...catalogRecord,
      localPresent: false,
      cloudPresent: false,
      syncStatus: "deleted",
      deletedAt: "2026-01-02T00:00:00.000Z",
      binding: null,
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).restoreWriting({
      writingId: id,
      version: 1,
      updatedAt: "2026-07-29T20:30:02.000Z",
    })

    expect(result.error).toBeNull()
    expect(mocks.dualWrite).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3",
      expect.objectContaining({
        mutation: expect.objectContaining({
          operation: "upsert",
          payloadJson: expect.stringContaining("restore"),
        }),
      }),
    )
    expect(mocks.syncFlush).toHaveBeenCalledTimes(1)
  })

  it("rejects a stale desktop restore before writing a mutation", async () => {
    mocks.catalogGet.mockResolvedValue({
      ...catalogRecord,
      version: 2,
      deletedAt: "2026-01-02T00:00:00.000Z",
      binding: null,
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).restoreWriting({
      writingId: id,
      version: 1,
      updatedAt: "2026-07-29T20:30:02.000Z",
    })

    expect(result.error).toMatchObject({ code: "CONFLICT" })
    expect(mocks.dualWrite).not.toHaveBeenCalled()
    expect(mocks.syncFlush).not.toHaveBeenCalled()
  })

  it("keeps a failed restore archived and reports the cloud failure", async () => {
    const archived = {
      ...catalogRecord,
      localPresent: false,
      cloudPresent: false,
      syncStatus: "deleted" as const,
      deletedAt: "2026-01-02T00:00:00.000Z",
      binding: null,
    }
    mocks.catalogGet.mockResolvedValue(archived)
    mocks.syncFlush.mockImplementation(async () => {
      const optimisticWrite = mocks.dualWrite.mock.calls[0]?.[1] as { mutation?: { id?: string } }
      return {
        data: { processedMutations: 1, failedMutations: [optimisticWrite.mutation?.id], nextRetryAt: null },
        error: null,
      }
    })

    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).restoreWriting({
      writingId: id,
      version: 1,
      updatedAt: "2026-07-29T20:30:02.000Z",
    })

    expect(result.error).toMatchObject({ code: "UNAVAILABLE" })
    expect(mocks.dualWrite).toHaveBeenCalledTimes(2)
    expect(mocks.dualWrite).toHaveBeenLastCalledWith(
      "/config/desktop-index.sqlite3",
      expect.objectContaining({
        document: expect.objectContaining({
          id,
          deletedAt: archived.deletedAt,
          syncStatus: "failed",
        }),
        mutation: expect.objectContaining({
          operation: "upsert",
          status: "failed",
          payloadJson: expect.stringContaining("restore"),
          nextRetryAt: expect.any(Number),
        }),
      }),
    )
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
    expect(mocks.scheduleSyncFlush).toHaveBeenCalledTimes(1)
    expect(mocks.dualWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scheduleSyncFlush.mock.invocationCallOrder[0],
    )
  })

  describe("incremental manifest update on save (ODE-459)", () => {
    const touchedFile = {
      id,
      path,
      relativePath: "Letter.md",
      inode: 77,
      contentHash: "blake3:b",
      size: 9,
      modifiedAt: 3,
    }

    beforeEach(() => {
      mocks.workspaceTouch.mockResolvedValue({
        status: "updated",
        rootPath: "/docs",
        bindingRootId: "root-1",
        file: touchedFile,
      })
    })

    it("refreshes only the saved document's manifest entry and never rescans the BindingRoot", async () => {
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const result = await (await getDocumentService()).saveWriting({ writing })

      expect(result.error).toBeNull()
      expect(mocks.workspaceTouch).toHaveBeenCalledTimes(1)
      expect(mocks.workspaceTouch).toHaveBeenCalledWith("/docs", "Letter.md", id)
      expect(mocks.workspaceSync).not.toHaveBeenCalled()
      // One save is still one logical catalog update, not N per file in the root.
      expect(mocks.dualWrite).toHaveBeenCalledTimes(1)
      expect(mocks.saveFile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.workspaceTouch.mock.invocationCallOrder[0],
      )
      expect(mocks.workspaceTouch.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.dualWrite.mock.invocationCallOrder[0],
      )
      expect(mocks.dualWrite).toHaveBeenCalledWith(
        "/config/desktop-index.sqlite3",
        expect.objectContaining({
          document: expect.objectContaining({ id }),
          binding: expect.objectContaining({
            bindingRootId: "root-1",
            rootPath: "/docs",
            relativePath: "Letter.md",
            canonicalPath: path,
            inode: 77,
            contentHash: "blake3:b",
          }),
        }),
      )
    })

    it("falls back to full reconciliation when the incremental update cannot verify the binding", async () => {
      mocks.workspaceTouch.mockResolvedValue({
        status: "needsReconcile",
        reason: "manifest is unreadable or corrupt",
      })

      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const result = await (await getDocumentService()).saveWriting({ writing })

      expect(result.error).toBeNull()
      expect(mocks.workspaceTouch).toHaveBeenCalledTimes(1)
      expect(mocks.workspaceSync).toHaveBeenCalledTimes(1)
      expect(mocks.workspaceSync).toHaveBeenCalledWith("/docs", undefined, { "Letter.md": id })
      expect(mocks.dualWrite).toHaveBeenCalledWith(
        "/config/desktop-index.sqlite3",
        expect.objectContaining({ binding: expect.objectContaining({ contentHash: "blake3:a" }) }),
      )
    })

    it("keeps a manifest write failure recoverable: no SQLite projection, no draft fallback", async () => {
      mocks.workspaceTouch.mockRejectedValue(new Error("workspace_sync atomic rename index: EIO"))

      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const result = await (await getDocumentService()).saveWriting({ writing })

      expect(result.error).toMatchObject({ code: "DB_ERROR" })
      expect(mocks.saveFile).toHaveBeenCalledTimes(1)
      expect(mocks.dualWrite).not.toHaveBeenCalled()
      expect(mocks.createDraft).not.toHaveBeenCalled()
    })

    it("uses full reconciliation when the document has no durable binding yet", async () => {
      mocks.catalogGet.mockResolvedValue(null)

      const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
      const result = await createDesktopDraft({ writingId: id, initialBodyText: "First words" })

      expect(result.error).toBeNull()
      expect(mocks.workspaceTouch).not.toHaveBeenCalled()
      expect(mocks.workspaceSync).toHaveBeenCalledTimes(1)
    })
  })

  describe("durable mutation payload weight (ODE-453)", () => {
    const bigPlainText = "Lorem ipsum dolor sit amet. ".repeat(2000)
    const bigWriting = {
      ...writing,
      content: {
        richText: {
          type: "doc",
          content: Array.from({ length: 200 }, (_, index) => ({
            type: "paragraph",
            content: [{ type: "text", text: `Paragraph ${index}: ${bigPlainText}` }],
          })),
        },
        markdown: null,
        plainText: bigPlainText,
        canonicalSource: "rich-text" as const,
      },
    }

    function touchedFileWithHash(contentHash: string) {
      return { id, path, relativePath: "Letter.md", inode: 77, contentHash, size: 9, modifiedAt: 3 }
    }

    function lastMutationPayload() {
      const call = mocks.dualWrite.mock.calls.at(-1)?.[1] as { mutation: { payloadJson: string } }
      return JSON.parse(call.mutation.payloadJson) as Record<string, unknown>
    }

    it("never embeds bodyJson/bodyText in the durable SQLite mutation for a bound document", async () => {
      mocks.workspaceTouch.mockResolvedValue({
        status: "updated", rootPath: "/docs", bindingRootId: "root-1", file: touchedFileWithHash("blake3:b"),
      })
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const result = await (await getDocumentService()).saveWriting({ writing: bigWriting })

      expect(result.error).toBeNull()
      const payload = lastMutationPayload()
      expect(payload).not.toHaveProperty("bodyJson")
      expect(payload).not.toHaveProperty("bodyText")
      // Identity + operation + metadata + version + hash, never a body copy —
      // this stays small regardless of how large the document is.
      expect(JSON.stringify(payload).length).toBeLessThan(700)
    })

    it("keeps the mutation payload the same size for a large document as for a small one", async () => {
      mocks.workspaceTouch.mockResolvedValue({
        status: "updated", rootPath: "/docs", bindingRootId: "root-1", file: touchedFileWithHash("blake3:b"),
      })
      const { getDocumentService } = await import("@/lib/services/document-service-factory")

      await (await getDocumentService()).saveWriting({ writing })
      const smallBytes = JSON.stringify(lastMutationPayload()).length

      mocks.dualWrite.mockClear()
      await (await getDocumentService()).saveWriting({ writing: bigWriting })
      const largeBytes = JSON.stringify(lastMutationPayload()).length

      expect(largeBytes).toBe(smallBytes)
    })

    it("marks contentUnchanged and carries the content hash when the file bytes did not change on an already cloud-present document", async () => {
      mocks.catalogGet.mockResolvedValue({
        ...catalogRecord, cloudPresent: true, cloudAccountId: "account-1",
        binding: { ...catalogRecord.binding!, contentHash: "blake3:same" },
      })
      mocks.workspaceTouch.mockResolvedValue({
        status: "updated", rootPath: "/docs", bindingRootId: "root-1", file: touchedFileWithHash("blake3:same"),
      })
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const result = await (await getDocumentService()).saveWriting({ writing })

      expect(result.error).toBeNull()
      const payload = lastMutationPayload()
      expect(payload.contentUnchanged).toBe(true)
      expect(payload.contentHash).toBe("blake3:same")
    })

    it("does not mark contentUnchanged when the file hash changed", async () => {
      mocks.catalogGet.mockResolvedValue({
        ...catalogRecord, cloudPresent: true, cloudAccountId: "account-1",
        binding: { ...catalogRecord.binding!, contentHash: "blake3:old" },
      })
      mocks.workspaceTouch.mockResolvedValue({
        status: "updated", rootPath: "/docs", bindingRootId: "root-1", file: touchedFileWithHash("blake3:new"),
      })
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      await (await getDocumentService()).saveWriting({ writing })

      const payload = lastMutationPayload()
      expect(payload.contentUnchanged).toBe(false)
      expect(payload.contentHash).toBe("blake3:new")
    })

    it("never marks contentUnchanged for a document that is not yet cloud-present, even with a matching hash", async () => {
      mocks.catalogGet.mockResolvedValue({
        ...catalogRecord, cloudPresent: false,
        binding: { ...catalogRecord.binding!, contentHash: "blake3:same" },
      })
      mocks.workspaceTouch.mockResolvedValue({
        status: "updated", rootPath: "/docs", bindingRootId: "root-1", file: touchedFileWithHash("blake3:same"),
      })
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      await (await getDocumentService()).saveWriting({ writing })

      const payload = lastMutationPayload()
      expect(payload.contentUnchanged).toBe(false)
    })
  })

  it("updates local-only desktop metadata without rewriting or enqueueing cloud work", async () => {
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
          syncStatus: "local-only",
        }),
        binding: expect.objectContaining({ canonicalPath: path, contentHash: "blake3:a" }),
        mutation: null,
      }),
    ])
    expect(mocks.scheduleSyncFlush).not.toHaveBeenCalled()
  })

  it("enqueues metadata updates for a document that already has cloud ownership", async () => {
    mocks.catalogGet.mockResolvedValue({
      ...catalogRecord,
      cloudPresent: true,
      cloudAccountId: "account-1",
      syncStatus: "synced",
    })
    const { getDocumentService } = await import("@/lib/services/document-service-factory")
    const result = await (await getDocumentService()).updateWritingMetadata({
      writingId: id,
      status: "done",
      artifactType: "skill",
      version: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(mocks.bulkDualWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        document: expect.objectContaining({ syncStatus: "pending" }),
        mutation: expect.objectContaining({
          operation: "upsert",
          payloadJson: expect.stringContaining('"mutationKind":"metadata"'),
        }),
      }),
    ])
    expect(mocks.scheduleSyncFlush).toHaveBeenCalledTimes(1)
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

  describe("DesktopDocumentService filesystem boundary contract", () => {
    const sourcePath = `${process.cwd()}/lib/services/document-service-factory.ts`

    // Exact, literal scan boundary. Class methods are the DesktopDocumentService
    // methods whose body delegates through this.runtime.filesystem/this.persist(
    // and whose first parameter is id: string or *WritingInput. Module functions
    // are the exported functions whose body touches a native fs boundary
    // (tauri-commands or runtime.filesystem) or whose first parameter is
    // id: string, plus the explicitly named createDesktopDraft (decision E:
    // it delegates through the service instance, so the generic predicate
    // cannot discover it). markDesktopWritingDeletedByCanonicalPath is excluded
    // on purpose: it only touches the catalog (resolvePath/detachLocalFile).
    const EXPECTED_CLASS_METHODS = [
      "deleteWriting",
      "downloadWriting",
      "exportWriting",
      "openWriting",
      "performRenameWriting",
      "saveWriting",
    ]
    const EXPECTED_MODULE_FUNCTIONS = [
      "createDesktopDraft",
      "getDesktopWritingCanonicalPath",
      "relocateDesktopWriting",
      "relocateDesktopWritingByCanonicalPath",
    ]

    function collectFilesystemBoundaryTargets(sourcePath: string) {
      const sourceText = ts.sys.readFile(sourcePath)
      if (!sourceText) throw new Error(`Could not read ${sourcePath}`)
      const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

      const classMethods: { name: string; shape: "id" | "writingId" | "writingRecord" }[] = []
      const moduleFunctions: string[] = []
      const boundaryTokens = [
        "tauriWriteFile",
        "tauriOpenFile",
        "tauriRelocateFile",
        "tauriWorkspaceSync",
        "tauriWorkspaceTouchFile",
        "runtime.filesystem",
      ]
      const namedModuleTargets = new Set(["createDesktopDraft"])

      function visit(node: ts.Node) {
        if (ts.isClassDeclaration(node) && node.name?.text === "DesktopDocumentService") {
          for (const member of node.members) {
            if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue
            const methodName = member.name.text
            if (methodName === "constructor") continue

            const bodyText = member.getText(sourceFile)
            // saveWriting delegates through this.persistFollowingRename(, not
            // this.persist( — the pack's literal predicate skipped the whole
            // save path. /this\.persist/ reaches persist and its rename retry.
            if (!bodyText.includes("this.runtime.filesystem") && !/this\.persist/.test(bodyText)) continue

            const param = member.parameters[0]
            if (!param) continue

            const paramName = param.name.getText(sourceFile)
            const paramType = param.type?.getText(sourceFile) ?? ""

            let shape: "id" | "writingId" | "writingRecord" | null = null
            if (paramName === "id" && paramType === "string") {
              shape = "id"
            } else if (paramType === "SaveWritingInput") shape = "writingRecord"
            else if (paramType.endsWith("WritingInput")) shape = "writingId"

            if (shape) classMethods.push({ name: methodName, shape })
          }
        }
        if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
          const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
          if (isExported) {
            const bodyText = node.body?.getText(sourceFile) ?? ""
            const firstParam = node.parameters[0]
            const firstParamIsId =
              firstParam?.name.getText(sourceFile) === "id" &&
              firstParam.type?.getText(sourceFile) === "string"
            if (
              boundaryTokens.some((token) => bodyText.includes(token)) ||
              firstParamIsId ||
              namedModuleTargets.has(node.name.text)
            ) {
              moduleFunctions.push(node.name.text)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
      return {
        classMethods: classMethods.sort((left, right) => left.name.localeCompare(right.name)),
        moduleFunctions: moduleFunctions.sort(),
      }
    }

    function filesystemDoublePathArguments(callArg: unknown): string[] {
      if (typeof callArg === "string") return [callArg]
      if (!callArg || typeof callArg !== "object") return []
      const record = callArg as Record<string, unknown>
      if (typeof record.writingId === "string") return [record.writingId]
      if (record.writing && typeof record.writing === "object") {
        const writingRecord = record.writing as Record<string, unknown>
        if (typeof writingRecord.id === "string") return [writingRecord.id]
      }
      if (typeof record.path === "string") return [record.path]
      return []
    }

    // Path positions of the real signatures in lib/services/desktop/tauri-commands.ts.
    // Decision F: the same observer applies to class methods (persist/save and
    // delete) and to module-level functions. UUIDs are legitimate as workspace-sync
    // map VALUES and as workspace-touch documentId, so only path positions are read.
    function collectFilesystemPathArguments(): string[] {
      const pathArguments: string[] = []
      for (const [callArg] of mocks.openFile.mock.calls) pathArguments.push(...filesystemDoublePathArguments(callArg))
      for (const [callArg] of mocks.saveFile.mock.calls) pathArguments.push(...filesystemDoublePathArguments(callArg))
      for (const [callArg] of mocks.deleteFile.mock.calls) pathArguments.push(...filesystemDoublePathArguments(callArg))
      for (const [callArg] of mocks.renameFile.mock.calls) pathArguments.push(...filesystemDoublePathArguments(callArg))
      for (const [callArg] of mocks.downloadWriting.mock.calls) pathArguments.push(...filesystemDoublePathArguments(callArg))
      for (const [callArg] of mocks.exportFile.mock.calls) pathArguments.push(...filesystemDoublePathArguments(callArg))

      for (const [openPath] of mocks.tauriOpen.mock.calls) {
        if (typeof openPath === "string") pathArguments.push(openPath)
      }
      for (const [writePath] of mocks.tauriWrite.mock.calls) {
        if (typeof writePath === "string") pathArguments.push(writePath)
      }
      for (const [oldPath, newPath] of mocks.tauriRelocate.mock.calls) {
        if (typeof oldPath === "string") pathArguments.push(oldPath)
        if (typeof newPath === "string") pathArguments.push(newPath)
      }
      for (const [rootPath, selectedPaths, documentIds] of mocks.workspaceSync.mock.calls) {
        if (typeof rootPath === "string") pathArguments.push(rootPath)
        if (Array.isArray(selectedPaths)) {
          for (const selected of selectedPaths) {
            if (typeof selected === "string") pathArguments.push(selected)
          }
        }
        if (documentIds && typeof documentIds === "object") {
          pathArguments.push(...Object.keys(documentIds))
        }
      }
      for (const [rootPath, relativePath] of mocks.workspaceTouch.mock.calls) {
        if (typeof rootPath === "string") pathArguments.push(rootPath)
        if (typeof relativePath === "string") pathArguments.push(relativePath)
      }
      return pathArguments
    }

    function expectNoUuidInFilesystemPathPositions() {
      for (const pathArgument of collectFilesystemPathArguments()) {
        expect(pathArgument).not.toContain(id)
      }
    }

    const managedRecord = {
      ...catalogRecord,
      binding: {
        ...catalogRecord.binding,
        bindingRootId: "managed-root",
        relativePath: "Letter.md",
        canonicalPath: "/managed/Letter.md",
      },
    }
    const managedRoot = {
      id: "managed-root", rootPath: "/managed", kind: "managed" as const,
      visibleAsWorkspace: false, selectedPaths: [], consentedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const destinationRoot = {
      id: "dest-root", rootPath: "/chosen", kind: "external" as const,
      visibleAsWorkspace: false, selectedPaths: ["Other.md"],
      consentedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
    }
    const relocatedFile = {
      id, path: "/chosen/Renamed.md", relativePath: "Renamed.md",
      inode: 7, contentHash: "blake3:b", size: 8, modifiedAt: 9,
    }

    function useManagedRelocateSetup() {
      mocks.catalogGet.mockResolvedValue(managedRecord)
      mocks.tauriRelocate.mockResolvedValue("/chosen/Renamed.md")
      mocks.getBindingRoots.mockResolvedValue([managedRoot])
      mocks.workspaceSync.mockImplementation(async (rootPath: string) => ({
        rootPath,
        bindingRootId: rootPath === "/managed" ? "managed-root" : "dest-root",
        selectedPaths: rootPath === "/managed" ? [] : ["Renamed.md"],
        files: rootPath === "/managed" ? [] : [relocatedFile],
      }))
    }

    it("discovers exactly the declared class methods and module-level fs boundary functions", () => {
      const targets = collectFilesystemBoundaryTargets(sourcePath)
      expect(targets.classMethods.map(({ name }) => name)).toEqual(EXPECTED_CLASS_METHODS)
      expect(targets.moduleFunctions).toEqual(EXPECTED_MODULE_FUNCTIONS)
    })

    it("never passes a raw document UUID through any filesystem-delegating service method", async () => {
      const { classMethods } = collectFilesystemBoundaryTargets(sourcePath)
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const service = await getDocumentService()

      for (const method of classMethods) {
        vi.clearAllMocks()
        mocks.catalogGet.mockResolvedValue(catalogRecord)
        mocks.openFile.mockResolvedValue({
          data: { ...writing, id: path, content: { ...writing.content, markdown: "Hello", richText: null } },
          error: null,
        })
        mocks.renameFile.mockResolvedValue({ data: { ...writing, id: path, title: "Renamed" }, error: null })
        mocks.createDraft.mockResolvedValue({ data: { path, writing: { ...writing, id: path } }, error: null })
        mocks.saveFile.mockResolvedValue({ data: writing, error: null })
        mocks.deleteFile.mockResolvedValue({ data: { ...writing, deletedAt: "2026-01-02T00:00:00.000Z" }, error: null })
        mocks.workspaceSync.mockResolvedValue({
          rootPath: "/docs", bindingRootId: "root-1", selectedPaths: ["Letter.md"],
          files: [{ id, path, relativePath: "Letter.md", inode: 1, contentHash: "blake3:a", size: 5, modifiedAt: 2 }],
        })

        let input: unknown
        if (method.shape === "id") input = id
        else if (method.shape === "writingId") {
          input = { writingId: id, format: "pdf" as const, version: 2, updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: "2026-01-02T00:00:00.000Z", title: "Renamed" }
        } else {
          input = { writing: { ...writing, id } }
        }

        await (service[method.name as keyof typeof service] as (input: unknown) => Promise<unknown>)(input)

        expectNoUuidInFilesystemPathPositions()
      }
    })

    it("relocateDesktopWriting with content: commits to the canonical path, moves and binds by path", async () => {
      useManagedRelocateSetup()
      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")

      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "# Letter\n\nHello\n")

      // Positive scope control: the branch reached its outcome and its fs calls.
      expect(result).toEqual({ status: "relocated", path: "/chosen/Renamed.md" })
      expect(mocks.tauriWrite).toHaveBeenCalledWith("/managed/Letter.md", "# Letter\n\nHello\n")
      expect(mocks.tauriRelocate).toHaveBeenCalledWith("/managed/Letter.md", "/chosen/Renamed.md")
      // Scope control: the UUID is a legitimate workspace-sync map VALUE here,
      // so the assertion must stay scoped to path positions.
      expect(mocks.workspaceSync).toHaveBeenCalledWith("/chosen", ["Renamed.md"], { "Renamed.md": id })
      expectNoUuidInFilesystemPathPositions()
    })

    it("relocateDesktopWriting without content: reads the moved file by path, never by UUID", async () => {
      useManagedRelocateSetup()
      mocks.tauriOpen.mockResolvedValue("# Letter\n\nHello\n")
      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")

      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md")

      expect(result).toEqual({ status: "relocated", path: "/chosen/Renamed.md" })
      expect(mocks.tauriWrite).not.toHaveBeenCalled()
      expect(mocks.tauriOpen).toHaveBeenCalledWith("/chosen/Renamed.md")
      expectNoUuidInFilesystemPathPositions()
    })

    it("relocateDesktopWriting retries the destination manifest scope by path, never by UUID", async () => {
      mocks.catalogGet.mockResolvedValue(managedRecord)
      mocks.tauriRelocate.mockResolvedValue("/chosen/Renamed.md")
      mocks.getBindingRoots.mockResolvedValue([managedRoot, destinationRoot])
      let destinationCalls = 0
      mocks.workspaceSync.mockImplementation(async (rootPath: string) => {
        if (rootPath === "/managed") {
          return { rootPath, bindingRootId: "managed-root", selectedPaths: [], files: [] }
        }
        destinationCalls += 1
        return {
          rootPath,
          bindingRootId: "dest-root",
          selectedPaths: ["Other.md", "Renamed.md"],
          files: destinationCalls === 1 ? [] : [relocatedFile],
        }
      })
      const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")

      const result = await relocateDesktopWriting(id, "/chosen/Renamed.md", "# Letter\n\nHello\n")

      expect(result).toEqual({ status: "relocated", path: "/chosen/Renamed.md" })
      expect(destinationCalls).toBe(2)
      expect(mocks.workspaceSync).toHaveBeenNthCalledWith(1, "/chosen", ["Other.md", "Renamed.md"], { "Renamed.md": id })
      expect(mocks.workspaceSync).toHaveBeenNthCalledWith(2, "/chosen", ["Other.md", "Renamed.md"], { "Renamed.md": id })
      expectNoUuidInFilesystemPathPositions()
    })

    it("relocateDesktopWritingByCanonicalPath: scans by the catalog-resolved root, never by UUID", async () => {
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

      expect(mocks.workspaceSync).toHaveBeenCalledWith("/docs")
      expect(mocks.applyReconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          upserts: [expect.objectContaining({
            documentId: id,
            canonicalPath: "/docs/Sub/Letter.md",
          })],
        }),
      )
      expectNoUuidInFilesystemPathPositions()
    })

    it("getDesktopWritingCanonicalPath resolves the UUID through the catalog to its bound path", async () => {
      mocks.catalogGet.mockResolvedValue(catalogRecord)
      const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")

      const result = await getDesktopWritingCanonicalPath(id)

      expect(result).toBe(path)
      expect(mocks.catalogGet).toHaveBeenCalledWith(id)
      expectNoUuidInFilesystemPathPositions()
    })

    it("getDesktopWritingCanonicalPath returns null for an unbound UUID, never the UUID", async () => {
      mocks.catalogGet.mockResolvedValue(null)
      const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")

      await expect(getDesktopWritingCanonicalPath(id)).resolves.toBeNull()
      expect(mocks.catalogGet).toHaveBeenCalledWith(id)
      expectNoUuidInFilesystemPathPositions()
    })

    it("createDesktopDraft (wrapper) allocates and binds by path, never by UUID", async () => {
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
      // Scope control: the UUID is the legitimate documentId of workspace_touch_file.
      expect(mocks.workspaceTouch).toHaveBeenCalledWith("/docs", "Letter.md", id)
      expectNoUuidInFilesystemPathPositions()
    })

    it("falls back to web export for a cloud-only record without durable local effects", async () => {
      mocks.catalogGet.mockResolvedValue({
        ...catalogRecord,
        localPresent: false,
        cloudPresent: true,
        cloudAccountId: "account-1",
        binding: null,
      })
      const { getDocumentService } = await import("@/lib/services/document-service-factory")
      const result = await (await getDocumentService()).exportWriting({ writingId: id, format: "pdf" })

      expect(result.error).toEqual({
        code: "UNAVAILABLE",
        message: "This artifact has no local copy on this machine",
      })
      expect(mocks.webExport).toHaveBeenCalledWith({ writingId: id, format: "pdf" })
      expect(mocks.exportFile).not.toHaveBeenCalled()
      expect(mocks.createDraft).not.toHaveBeenCalled()
      expect(mocks.dualWrite).not.toHaveBeenCalled()
      expect(mocks.bulkDualWrite).not.toHaveBeenCalled()
    })
  })
})
