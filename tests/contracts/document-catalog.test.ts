import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalog } from "@/lib/services/contracts/document-catalog"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { WebDocumentCatalog } from "@/lib/services/web-document-catalog"

const mocks = vi.hoisted(() => ({
  catalogGet: vi.fn(), catalogResolve: vi.fn(), catalogList: vi.fn(), catalogWrite: vi.fn(), catalogBulkWrite: vi.fn(),
  catalogDetach: vi.fn(), catalogHydrateExcerpts: vi.fn(),
  catalogApplyReconcile: vi.fn(),
  catalogApplyWorkspaceRemoval: vi.fn(),
  writingGet: vi.fn(), writingGetByPath: vi.fn(), writingGetAll: vi.fn(), writingSave: vi.fn(), writingDetach: vi.fn(),
  localListener: null as null | (() => void),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCatalogGetById: mocks.catalogGet,
  tauriCatalogResolvePath: mocks.catalogResolve,
  tauriCatalogList: mocks.catalogList,
  tauriCatalogDualWrite: mocks.catalogWrite,
  tauriCatalogBulkDualWrite: mocks.catalogBulkWrite,
  tauriCatalogDetachLocalFile: mocks.catalogDetach,
  tauriCatalogHydrateExcerpts: mocks.catalogHydrateExcerpts,
  tauriCatalogApplyReconcile: mocks.catalogApplyReconcile,
  tauriCatalogApplyWorkspaceRemoval: mocks.catalogApplyWorkspaceRemoval,
}))

vi.mock("@/lib/local-db", () => ({
  localDB: { writings: {
    get: mocks.writingGet, getByCanonicalPath: mocks.writingGetByPath, getAll: mocks.writingGetAll,
    save: mocks.writingSave, detachLocalFile: mocks.writingDetach,
  } },
  subscribeToLocalDBChanges: (listener: () => void) => { mocks.localListener = listener; return () => { mocks.localListener = null } },
}))

const nativeRow = {
  id: "doc-1", localPresent: true, cloudPresent: false, cloudAccountId: null, syncStatus: "pending",
  title: "Doc", slug: null, status: "draft", artifactType: "general", visibility: "private", version: 1,
  deletedAt: null, createdAt: 1, modifiedAt: 2, bindingRootId: "root-1", relativePath: "Doc.md",
  canonicalPath: "/tmp/Doc.md", inode: null, contentHash: "blake3:abc", size: 10, lastSeenAt: 2,
  excerpt: "Catalog excerpt", excerptContentHash: "blake3:abc",
}

const localWriting = {
  id: "doc-1", author_id: null, title: "Doc", canonical_path: "/tmp/Doc.md", body_json: {}, body_text: "",
  status: "draft", artifact_type: "general", visibility: "private", version: 1, sync_status: "pending",
  lifecycle: "local-only", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z",
  local_updated_at: 2,
}

function runReadConformance(name: string, create: () => DocumentCatalog) {
  describe(`${name} conformance`, () => {
    it("resolves the same identity by id and path", async () => {
      const catalog = create()
      expect((await catalog.getById("doc-1"))?.id).toBe("doc-1")
      const resolution = await catalog.resolvePath("/tmp/Doc.md")
      expect(resolution.kind).toBe("resolved")
      if (resolution.kind === "resolved") expect(resolution.record.id).toBe("doc-1")
    })

    it("lists local records without requiring an auth account", async () => {
      const records = await create().list({ cloudAccountId: null })
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ id: "doc-1", localPresent: true })
    })
  })
}

describe("DocumentCatalog contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.catalogGet.mockResolvedValue(nativeRow)
    mocks.catalogResolve.mockResolvedValue(nativeRow)
    mocks.catalogList.mockResolvedValue([nativeRow])
    mocks.catalogWrite.mockResolvedValue(undefined)
    mocks.catalogBulkWrite.mockResolvedValue(undefined)
    mocks.catalogDetach.mockResolvedValue(undefined)
    mocks.catalogHydrateExcerpts.mockResolvedValue([])
    mocks.catalogApplyReconcile.mockResolvedValue(true)
    mocks.catalogApplyWorkspaceRemoval.mockResolvedValue([])
    mocks.writingGet.mockResolvedValue(localWriting)
    mocks.writingGetByPath.mockResolvedValue(localWriting)
    mocks.writingGetAll.mockResolvedValue([localWriting])
    mocks.writingSave.mockResolvedValue(undefined)
    mocks.writingDetach.mockResolvedValue(undefined)
  })

  runReadConformance("SQLite desktop adapter", () => new SqliteDocumentCatalog("/tmp/catalog.db"))
  runReadConformance("IndexedDB web adapter", () => new WebDocumentCatalog())

  it("emits one CatalogChange for one native logical transaction", async () => {
    const catalog = new SqliteDocumentCatalog("/tmp/catalog.db")
    const changes: unknown[] = []
    const unsubscribe = catalog.subscribe((change) => changes.push(change))
    await catalog.commitDualWrite({
      document: { ...nativeRow, artifactType: "general" }, binding: null, mutation: null,
    })
    expect(changes).toHaveLength(1)
    expect(mocks.catalogWrite).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("projects the native reference targets into the catalog contract", async () => {
    mocks.catalogGet.mockResolvedValueOnce({
      ...nativeRow,
      referenceTargets: [{ value: "notes/target.md", kind: "path" }],
      referenceTargetsContentHash: "blake3:abc",
    })

    const record = await new SqliteDocumentCatalog("/tmp/catalog-references.db").getById("doc-1")

    expect(record?.referenceTargets).toEqual([{ value: "notes/target.md", kind: "path" }])
  })

  it("treats an empty native reference projection as authoritative", async () => {
    mocks.catalogGet.mockResolvedValueOnce({
      ...nativeRow,
      referenceTargets: null,
      referenceTargetsContentHash: "blake3:abc",
    })

    const record = await new SqliteDocumentCatalog("/tmp/catalog-empty-references.db").getById("doc-1")

    expect(record?.referenceTargets).toBeNull()
  })

  it("emits one bulk CatalogChange for N metadata commits", async () => {
    const catalog = new SqliteDocumentCatalog("/tmp/catalog-bulk.db")
    const changes: Array<{ documentIds: string[]; reason: string }> = []
    const unsubscribe = catalog.subscribe((change) => changes.push(change))
    await catalog.commitBulkDualWrite([
      { document: { ...nativeRow, id: "doc-1" }, binding: null, mutation: null },
      { document: { ...nativeRow, id: "doc-2" }, binding: null, mutation: null },
      { document: { ...nativeRow, id: "doc-3" }, binding: null, mutation: null },
    ])
    expect(mocks.catalogBulkWrite).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ documentIds: ["doc-1", "doc-2", "doc-3"], reason: "bulk" })
    unsubscribe()
  })

  it("shares one CatalogChange bus across desktop writers for the same database", async () => {
    const reader = new SqliteDocumentCatalog("/tmp/shared-catalog.db")
    const writer = new SqliteDocumentCatalog("/tmp/shared-catalog.db")
    const unrelated = new SqliteDocumentCatalog("/tmp/other-catalog.db")
    const changes: unknown[] = []
    const unsubscribe = reader.subscribe((change) => changes.push(change))

    await writer.commitDualWrite({
      document: { ...nativeRow, artifactType: "general" }, binding: null, mutation: null,
    })
    await unrelated.commitDualWrite({
      document: { ...nativeRow, artifactType: "general" }, binding: null, mutation: null,
    })

    expect(changes).toHaveLength(1)
    unsubscribe()
  })

  it("emits no CatalogChange when SQLite fences a late watcher transaction", async () => {
    const catalog = new SqliteDocumentCatalog("/tmp/retired-root.db")
    const changes: unknown[] = []
    const unsubscribe = catalog.subscribe((change) => changes.push(change))
    mocks.catalogApplyReconcile.mockResolvedValueOnce(false)

    const result = await catalog.applyReconcileTransaction({
      transactionId: "late-watcher",
      bindingRootId: "retired-root",
      rootPath: "/tmp/retired",
      visibleAsWorkspace: true,
      upserts: [{
        documentId: "doc-1",
        bindingRootId: "retired-root",
        relativePath: "Doc.md",
        canonicalPath: "/tmp/retired/Doc.md",
        inode: null,
        contentHash: "blake3:late",
        size: 10,
        modifiedAt: 2,
        strategy: "path",
      }],
      detached: [],
    })

    expect(result.documentIds).toEqual([])
    expect(changes).toEqual([])
    unsubscribe()
  })

  it("emits no CatalogChange when a workspace-removal retry is already retired", async () => {
    const catalog = new SqliteDocumentCatalog("/tmp/retired-root.db")
    const changes: unknown[] = []
    const unsubscribe = catalog.subscribe((change) => changes.push(change))

    const result = await catalog.applyWorkspaceRemoval(
      "retired-root",
      "/tmp/retired",
      "2026-08-02T00:00:00Z",
      "2026-08-02T00:00:00Z",
    )

    expect(result.documentIds).toEqual([])
    expect(changes).toEqual([])
    unsubscribe()
  })

  it("does not list records that exist in neither local nor cloud storage", async () => {
    mocks.catalogList.mockResolvedValue([
      nativeRow,
      { ...nativeRow, id: "detached-tombstone", localPresent: false, cloudPresent: false },
    ])

    const records = await new SqliteDocumentCatalog("/tmp/catalog.db").list()

    expect(records.map((record) => record.id)).toEqual(["doc-1"])
  })

  it("hydrates stale excerpts once per database and emits one bulk signal", async () => {
    mocks.catalogHydrateExcerpts.mockResolvedValueOnce(["doc-1", "doc-2"])
    const catalog = new SqliteDocumentCatalog("/tmp/excerpt-batch.sqlite3")
    const changes: Array<{ documentIds: string[]; reason: string }> = []
    const unsubscribe = catalog.subscribe((change) => changes.push(change))

    await Promise.all([catalog.list(), catalog.list()])
    await vi.waitFor(() => expect(changes).toHaveLength(1))

    expect(mocks.catalogHydrateExcerpts).toHaveBeenCalledTimes(1)
    expect(changes[0]).toMatchObject({
      documentIds: ["doc-1", "doc-2"],
      reason: "bulk",
    })
    unsubscribe()
  })

  it("does not expose an excerpt cached for an older content hash", async () => {
    mocks.catalogList.mockResolvedValueOnce([{
      ...nativeRow,
      contentHash: "blake3:new",
      excerpt: "Stale excerpt",
      excerptContentHash: "blake3:old",
    }])

    const records = await new SqliteDocumentCatalog("/tmp/stale-excerpt.sqlite3").list()

    expect(records[0].excerpt).toBeNull()
  })
})
