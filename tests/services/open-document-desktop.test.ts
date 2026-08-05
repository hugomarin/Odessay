/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  workspaceSync: vi.fn(),
  getBindingRoots: vi.fn(),
  getDesktopSettings: vi.fn(),
  upsertBindingRoot: vi.fn(),
  ensureManagedRoot: vi.fn(),
  listRecentFiles: vi.fn(),
  writeFile: vi.fn(),
  findEligibleCloudHash: vi.fn(),
  catalogGetById: vi.fn(),
  catalogResolvePath: vi.fn(),
  catalogRegisterBinding: vi.fn(),
  catalogList: vi.fn(),
  localGet: vi.fn(),
  localSave: vi.fn(),
  getSession: vi.fn(),
  fetchCloudWriting: vi.fn(),
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(async () => "/config"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriWorkspaceSync: mocks.workspaceSync,
  tauriListRecentFiles: mocks.listRecentFiles,
  tauriWriteFile: mocks.writeFile,
  tauriCatalogFindEligibleCloudHash: mocks.findEligibleCloudHash,
}))

vi.mock("@/lib/services/desktop/desktop-settings-service", () => ({
  DesktopSettingsService: class {
    getBindingRoots = mocks.getBindingRoots
    getDesktopSettings = mocks.getDesktopSettings
    upsertBindingRoot = mocks.upsertBindingRoot
    ensureManagedRoot = mocks.ensureManagedRoot
  },
}))

vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class {
    constructor(readonly dbPath: string) {}
    getById = mocks.catalogGetById
    resolvePath = mocks.catalogResolvePath
    registerBinding = mocks.catalogRegisterBinding
    list = mocks.catalogList
  },
}))

vi.mock("@/lib/local-db", () => ({
  localDB: { writings: { get: mocks.localGet, save: mocks.localSave } },
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: { getSession: mocks.getSession },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mocks.fetchCloudWriting }) }),
      }),
    }),
  }),
}))

function catalogRecord(overrides: Record<string, unknown>) {
  return {
    id: "id",
    localPresent: true,
    cloudPresent: false,
    cloudAccountId: null,
    syncStatus: "local-only",
    title: "Doc",
    slug: null,
    status: null,
    artifactType: null,
    visibility: null,
    version: null,
    createdAt: 1,
    modifiedAt: 1,
    binding: null,
    ...overrides,
  }
}

describe("open-document-desktop", () => {
  beforeEach(() => {
    vi.resetModules()
    Object.values(mocks).forEach((m) => m.mockReset())
    mocks.getBindingRoots.mockResolvedValue([])
    mocks.getDesktopSettings.mockResolvedValue({ data: { workspaces: [] }, error: null })
    mocks.catalogList.mockResolvedValue([])
    mocks.listRecentFiles.mockResolvedValue([])
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.findEligibleCloudHash.mockResolvedValue([])
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: "acct-1" } } },
      error: null,
    })
    mocks.fetchCloudWriting.mockResolvedValue({
      data: {
        id: "cloud-1", author_id: "acct-1", title: "Cloud letter",
        body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
        slug: null, status: "draft", artifact_type: "general", visibility: "private",
        version: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    })
    mocks.ensureManagedRoot.mockResolvedValue({ id: "managed-root", rootPath: "/config/artifact-studio-managed" })
    mocks.localGet.mockResolvedValue(undefined)
    mocks.catalogRegisterBinding.mockImplementation(async (input: { document: { id: string }; binding: unknown }) =>
      catalogRecord({ id: input.document.id, binding: input.binding }),
    )
  })

  it("registers the external root with the manifest's bindingRootId, not a fresh UUID", async () => {
    const path = "/Users/me/Notes/note.md"
    mocks.catalogResolvePath.mockResolvedValue({ kind: "unbound", path })
    // File is outside every registered root/workspace.
    mocks.getBindingRoots.mockResolvedValue([])
    // The manifest mints and persists the durable bindingRootId.
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/Users/me/Notes",
      bindingRootId: "manifest-root-id",
      name: "Notes",
      fileCount: 1,
      folderCount: 0,
      updatedAt: 1,
      selectedPaths: ["note.md"],
      files: [
        { id: "manifest-doc-id", path, relativePath: "note.md", name: "note.md", modifiedAt: 1, size: 10, inode: 5, contentHash: "h" },
      ],
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "path", path, confirmRegisterRoot: true })

    expect(result.status).toBe("opened")
    // Settings, catalog binding and manifest all agree on the SAME id.
    expect(mocks.upsertBindingRoot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "manifest-root-id", selectedPaths: ["note.md"], kind: "external" }),
    )
    expect(mocks.catalogRegisterBinding).toHaveBeenCalledWith(
      expect.objectContaining({ binding: expect.objectContaining({ bindingRootId: "manifest-root-id" }) }),
    )
    // The manifest is written before Settings (ordering guarantee).
    const syncOrder = mocks.workspaceSync.mock.invocationCallOrder[0]
    const upsertOrder = mocks.upsertBindingRoot.mock.invocationCallOrder[0]
    expect(syncOrder).toBeLessThan(upsertOrder)
    // No empty draft is ever seeded into IndexedDB by the opener.
    expect(mocks.localSave).not.toHaveBeenCalled()
  })

  it("does not seed IndexedDB when opening an already-bound path", async () => {
    const path = "/root/a.md"
    mocks.catalogResolvePath.mockResolvedValue({
      kind: "resolved",
      record: catalogRecord({ id: "doc-1", binding: { canonicalPath: path } }),
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "path", path })

    expect(result).toMatchObject({ status: "opened", documentId: "doc-1" })
    expect(mocks.localSave).not.toHaveBeenCalled()
    expect(mocks.catalogRegisterBinding).not.toHaveBeenCalled()
  })

  it("preserves a full Workspace scope when opening one previously unbound file", async () => {
    const path = "/Users/me/Writings/c.md"
    mocks.catalogResolvePath.mockResolvedValue({ kind: "unbound", path })
    mocks.getBindingRoots.mockResolvedValue([{
      id: "root-writings", rootPath: "/Users/me/Writings", kind: "external",
      visibleAsWorkspace: true, selectedPaths: [], consentedAt: "now", createdAt: "now",
    }])
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/Users/me/Writings", bindingRootId: "root-writings", name: "Writings",
      selectedPaths: [], fileCount: 3, folderCount: 0, updatedAt: 3,
      files: [
        { id: "doc-a", path: "/Users/me/Writings/a.md", relativePath: "a.md", name: "a.md", modifiedAt: 1, size: 1, inode: 1, contentHash: "ha" },
        { id: "doc-b", path: "/Users/me/Writings/b.md", relativePath: "b.md", name: "b.md", modifiedAt: 2, size: 1, inode: 2, contentHash: "hb" },
        { id: "doc-c", path, relativePath: "c.md", name: "c.md", modifiedAt: 3, size: 1, inode: 3, contentHash: "hc" },
      ],
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "path", path })

    expect(result).toMatchObject({ status: "opened", documentId: "doc-c" })
    expect(mocks.workspaceSync).toHaveBeenCalledWith("/Users/me/Writings", [])
    expect(mocks.workspaceSync).not.toHaveBeenCalledWith("/Users/me/Writings", ["c.md"])
  })

  it("extends a limited external scope additively instead of replacing siblings", async () => {
    const path = "/Users/me/Notes/new.md"
    mocks.catalogResolvePath.mockResolvedValue({ kind: "unbound", path })
    mocks.getBindingRoots.mockResolvedValue([{
      id: "root-notes", rootPath: "/Users/me/Notes", kind: "external",
      visibleAsWorkspace: false, selectedPaths: ["existing.md"], consentedAt: "now", createdAt: "now",
    }])
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/Users/me/Notes", bindingRootId: "root-notes", name: "Notes",
      selectedPaths: ["existing.md", "new.md"], fileCount: 2, folderCount: 0, updatedAt: 2,
      files: [
        { id: "doc-existing", path: "/Users/me/Notes/existing.md", relativePath: "existing.md", name: "existing.md", modifiedAt: 1, size: 1, inode: 1, contentHash: "he" },
        { id: "doc-new", path, relativePath: "new.md", name: "new.md", modifiedAt: 2, size: 1, inode: 2, contentHash: "hn" },
      ],
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "path", path })

    expect(result).toMatchObject({ status: "opened", documentId: "doc-new" })
    expect(mocks.workspaceSync).toHaveBeenCalledWith(
      "/Users/me/Notes",
      ["existing.md", "new.md"],
    )
    expect(mocks.upsertBindingRoot).toHaveBeenCalledWith(
      expect.objectContaining({ selectedPaths: ["existing.md", "new.md"] }),
    )
  })

  it("does not revive an id from retired desktop IndexedDB compatibility", async () => {
    mocks.catalogGetById.mockResolvedValue(null)
    mocks.localGet.mockResolvedValue({
      id: "legacy-1",
      canonical_path: "/root/legacy.md",
      title: "Legacy",
      status: "draft",
      visibility: "private",
      version: 1,
      lifecycle: "local-only",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "id", id: "legacy-1" })

    expect(result).toEqual({ status: "orphaned", id: "legacy-1" })
    expect(mocks.localGet).not.toHaveBeenCalled()
    expect(mocks.localSave).not.toHaveBeenCalled()
  })

  it("returns orphaned for an id absent from both catalog and IndexedDB", async () => {
    mocks.catalogGetById.mockResolvedValue(null)
    mocks.localGet.mockResolvedValue(undefined)

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "id", id: "ghost" })

    expect(result).toEqual({ status: "orphaned", id: "ghost" })
  })

  it("materializes a cloud-only document before returning it to the editor", async () => {
    const cloud = catalogRecord({
      id: "cloud-1",
      localPresent: false,
      cloudPresent: true,
      cloudAccountId: "user-1",
      syncStatus: "synced",
      title: "Cloud letter",
      status: "draft",
      visibility: "private",
    })
    mocks.catalogGetById.mockResolvedValue(cloud)
    mocks.localGet.mockResolvedValue({
      id: "cloud-1",
      author_id: "user-1",
      title: "Cloud letter",
      body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
      body_text: "Hello",
      slug: null,
      status: "draft",
      artifact_type: "general",
      visibility: "private",
      version: 1,
      sync_status: "synced",
      lifecycle: "server-confirmed",
      deleted_at: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      local_updated_at: 1,
      canonical_path: null,
      content_hash: null,
    })
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/config/artifact-studio-managed",
      bindingRootId: "manifest-managed-root",
      name: "artifact-studio-managed",
      fileCount: 1,
      folderCount: 0,
      updatedAt: 2,
      selectedPaths: [],
      files: [{
        id: "cloud-1",
        path: "/config/artifact-studio-managed/Cloud letter.md",
        relativePath: "Cloud letter.md",
        name: "Cloud letter.md",
        modifiedAt: 2,
        size: 6,
        inode: 10,
        contentHash: "blake3:cloud",
      }],
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "id", id: "cloud-1" })

    expect(result).toMatchObject({ status: "opened", documentId: "cloud-1" })
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/config/artifact-studio-managed/Cloud letter.md",
      expect.stringContaining("Hello"),
    )
    expect(mocks.workspaceSync).toHaveBeenCalledWith(
      "/config/artifact-studio-managed",
      undefined,
      { "Cloud letter.md": "cloud-1" },
    )
    expect(mocks.catalogRegisterBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ id: "cloud-1", localPresent: true }),
        binding: expect.objectContaining({ documentId: "cloud-1", bindingRootId: "manifest-managed-root" }),
      }),
    )
    const writeOrder = mocks.writeFile.mock.invocationCallOrder[0]
    const manifestOrder = mocks.workspaceSync.mock.invocationCallOrder[0]
    const catalogOrder = mocks.catalogRegisterBinding.mock.invocationCallOrder[0]
    expect(writeOrder).toBeLessThan(manifestOrder)
    expect(manifestOrder).toBeLessThan(catalogOrder)
  })

  it("materializes into an explicitly selected external BindingRoot", async () => {
    const cloud = catalogRecord({ id: "cloud-2", localPresent: false, cloudPresent: true, syncStatus: "synced" })
    mocks.catalogGetById.mockResolvedValue(cloud)
    mocks.getBindingRoots.mockResolvedValue([{
      id: "external-1", rootPath: "/Users/me/Letters", kind: "external",
      visibleAsWorkspace: false, selectedPaths: ["existing.md"], consentedAt: "now", createdAt: "now",
    }])
    mocks.fetchCloudWriting.mockResolvedValue({
      data: {
        id: "cloud-2", author_id: "acct-1", title: "Chosen root",
        body_json: { type: "doc", content: [] }, slug: null, status: "draft",
        artifact_type: "general", visibility: "private", version: 1,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    })
    mocks.workspaceSync.mockResolvedValue({
      rootPath: "/Users/me/Letters", bindingRootId: "external-1", selectedPaths: ["existing.md", "Chosen root.md"],
      files: [{ id: "cloud-2", path: "/Users/me/Letters/Chosen root.md", relativePath: "Chosen root.md", name: "Chosen root.md", modifiedAt: 2, size: 0, inode: 4, contentHash: "blake3:empty" }],
    })

    const { openDesktopDocument } = await import("@/lib/services/desktop/open-document-desktop")
    const result = await openDesktopDocument({ kind: "id", id: "cloud-2", materializeInBindingRootId: "external-1" })

    expect(result.status).toBe("opened")
    expect(mocks.workspaceSync).toHaveBeenCalledWith(
      "/Users/me/Letters",
      ["existing.md", "Chosen root.md"],
      { "Chosen root.md": "cloud-2" },
    )
    expect(mocks.upsertBindingRoot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "external-1", selectedPaths: ["existing.md", "Chosen root.md"] }),
    )
    expect(mocks.ensureManagedRoot).not.toHaveBeenCalled()
  })
})
