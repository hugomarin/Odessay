/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  selectEq: vi.fn(),
  catalogGet: vi.fn(),
  applyCloudSnapshots: vi.fn(),
  enqueue: vi.fn(),
  listPending: vi.fn(),
  listMetadataPending: vi.fn(),
  updateStatus: vi.fn(),
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: async () => "/config",
  join: async (...parts: string[]) => parts.join("/"),
}))
vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: { getSession: mocks.getSession },
    from: () => ({ select: () => ({ eq: mocks.selectEq }) }),
  }),
}))
vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class {
    dbPath = "/config/desktop-index.sqlite3"
    getById = mocks.catalogGet
    applyCloudSnapshots = mocks.applyCloudSnapshots
  },
}))
vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCatalogEnqueueMutation: mocks.enqueue,
  tauriCatalogListPendingMutations: mocks.listPending,
  tauriCatalogListPendingMetadataMutations: mocks.listMetadataPending,
  tauriCatalogApplyCollectionSnapshot: vi.fn(),
  tauriCatalogUpdateMetadataMutationStatus: vi.fn(),
  tauriCatalogUpdateMutationStatus: mocks.updateStatus,
  tauriOpenFile: vi.fn(),
}))

describe("desktopCatalogSyncService", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null })
    mocks.catalogGet.mockResolvedValue({ id: "doc-1" })
    mocks.listPending.mockResolvedValue([])
    mocks.listMetadataPending.mockResolvedValue([])
  })

  it("enqueues writing mutations only in the durable SQLite queue", async () => {
    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.enqueueMutation({
      mutation: {
        id: "mutation-1", entityKind: "writing", entityId: "doc-1", operation: "upsert",
        createdAt: 1, attempts: 0,
        payload: {
          title: "Doc", bodyText: "Body", bodyJson: {}, slug: null, status: "draft",
          artifactType: "general", visibility: "private", parentId: null,
          correspondenceId: null, version: 1, updatedAt: "2026-01-01T00:00:00Z", deletedAt: null,
        },
      },
    })

    expect(result.error).toBeNull()
    expect(mocks.enqueue).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3",
      "doc-1",
      expect.objectContaining({ id: "mutation-1", operation: "upsert" }),
    )
  })

  it("hydrates cloud metadata into SQLite without opening IndexedDB", async () => {
    mocks.selectEq.mockResolvedValue({
      data: [{
        id: "doc-1", author_id: "user-1", title: "Doc", slug: null, status: "draft",
        artifact_type: "general", visibility: "private", version: 1,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
        content_hash: "blake3:a", deleted_at: null,
      }],
      error: null,
    })
    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.hydrateWritings()

    expect(result).toMatchObject({ data: { appliedCount: 1, hydratedIds: ["doc-1"] }, error: null })
    expect(mocks.applyCloudSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ id: "doc-1", cloudPresent: true, contentHash: "blake3:a" }),
    ])
  })

  it("reports the pending count from SQLite", async () => {
    mocks.listPending.mockResolvedValue([{ id: "m1", nextRetryAt: 10 }])
    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.getRuntimeState()
    expect(result.data?.pendingMutations).toBe(1)
  })
})
