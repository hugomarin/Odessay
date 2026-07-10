import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalog } from "@/lib/services/contracts/document-catalog"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { WebDocumentCatalog } from "@/lib/services/web-document-catalog"

const mocks = vi.hoisted(() => ({
  catalogGet: vi.fn(), catalogResolve: vi.fn(), catalogList: vi.fn(), catalogWrite: vi.fn(), catalogDetach: vi.fn(),
  writingGet: vi.fn(), writingGetByPath: vi.fn(), writingGetAll: vi.fn(), writingSave: vi.fn(), writingDetach: vi.fn(),
  localListener: null as null | (() => void),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCatalogGetById: mocks.catalogGet,
  tauriCatalogResolvePath: mocks.catalogResolve,
  tauriCatalogList: mocks.catalogList,
  tauriCatalogDualWrite: mocks.catalogWrite,
  tauriCatalogDetachLocalFile: mocks.catalogDetach,
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
  createdAt: 1, modifiedAt: 2, bindingRootId: "root-1", relativePath: "Doc.md",
  canonicalPath: "/tmp/Doc.md", inode: null, contentHash: "blake3:abc", size: 10, lastSeenAt: 2,
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
    mocks.catalogDetach.mockResolvedValue(undefined)
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
    catalog.subscribe((change) => changes.push(change))
    await catalog.commitDualWrite({
      document: { ...nativeRow, artifactType: "general" }, binding: null, mutation: null,
    })
    expect(changes).toHaveLength(1)
    expect(mocks.catalogWrite).toHaveBeenCalledTimes(1)
  })
})
