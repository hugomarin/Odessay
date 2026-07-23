/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  selectEq: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
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
    from: mocks.from,
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

function catalogRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1", localPresent: true, cloudPresent: false, cloudAccountId: null,
    syncStatus: "pending", title: "Doc", slug: null, status: "draft",
    artifactType: "general", visibility: "private", version: 2,
    deletedAt: null, createdAt: 100, modifiedAt: 200, binding: null,
    ...overrides,
  }
}

function mutationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1", documentId: "doc-1", operation: "upsert",
    payloadJson: JSON.stringify({
      title: "Doc", bodyText: "Body", bodyJson: {}, version: 2,
      updatedAt: "2026-07-22T10:00:00Z",
    }),
    status: "pending", attemptCount: 0, nextRetryAt: null, createdAt: 1, lastError: null,
    ...overrides,
  }
}

/** Wires the writings table mock: update/insert verified writes + select for hydration. */
function wireSupabaseTables() {
  mocks.from.mockImplementation(() => ({
    select: () => ({ eq: mocks.selectEq }),
    update: (row: unknown, opts: unknown) => ({
      eq: () => ({ eq: () => mocks.update(row, opts) }),
    }),
    insert: (row: unknown, opts: unknown) => mocks.insert(row, opts),
  }))
}

describe("desktopCatalogSyncService", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null })
    mocks.catalogGet.mockResolvedValue(catalogRecord())
    mocks.listPending.mockResolvedValue([])
    mocks.listMetadataPending.mockResolvedValue([])
    mocks.applyCloudSnapshots.mockResolvedValue(undefined)
    mocks.updateStatus.mockResolvedValue(undefined)
    wireSupabaseTables()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  // ── ODE-404 regression (a): a zero-row UPDATE is never marked synced ────────

  it("falls back to a verified INSERT when the cloud UPDATE affects 0 rows", async () => {
    mocks.catalogGet.mockResolvedValue(catalogRecord({ cloudPresent: true }))
    mocks.listPending.mockResolvedValue([mutationRow()])
    mocks.update.mockResolvedValue({ error: null, count: 0 })
    mocks.insert.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.flushPending()

    expect(result.data?.failedMutations).toEqual([])
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", author_id: "user-1" }),
      { count: "exact" },
    )
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3", "m1", "synced", 0, null, null,
    )
  })

  it("marks the mutation failed when neither UPDATE nor INSERT verifies a row", async () => {
    mocks.catalogGet.mockResolvedValue(catalogRecord({ cloudPresent: true }))
    mocks.listPending.mockResolvedValue([mutationRow()])
    mocks.update.mockResolvedValue({ error: null, count: 0 })
    mocks.insert.mockResolvedValue({ error: { message: "insert rejected", code: "42501" }, count: null })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.flushPending()

    expect(result.data?.failedMutations).toEqual(["m1"])
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3", "m1", "failed", 1, expect.any(Number), "insert rejected",
    )
    expect(mocks.applyCloudSnapshots).not.toHaveBeenCalled()
  })

  it("treats a write whose affected-row count cannot be determined as failed, never synced", async () => {
    mocks.catalogGet.mockResolvedValue(catalogRecord({ cloudPresent: true }))
    mocks.listPending.mockResolvedValue([mutationRow()])
    mocks.update.mockResolvedValue({ error: null, count: null })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.flushPending()

    expect(result.data?.failedMutations).toEqual(["m1"])
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3", "m1", "failed", 1, expect.any(Number),
      expect.stringContaining("did not report affected rows"),
    )
  })

  it("converges through a verified UPDATE when the INSERT hits a unique violation", async () => {
    mocks.listPending.mockResolvedValue([mutationRow()])
    mocks.insert.mockResolvedValue({ error: { message: "duplicate key", code: "23505" }, count: null })
    mocks.update.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.flushPending()

    expect(result.data?.failedMutations).toEqual([])
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3", "m1", "synced", 0, null, null,
    )
    expect(mocks.applyCloudSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ id: "doc-1", cloudPresent: true }),
    ])
  })

  it("materializes a verified tombstone when a delete matches no cloud row", async () => {
    mocks.catalogGet.mockResolvedValue(catalogRecord({ cloudPresent: true }))
    mocks.listPending.mockResolvedValue([mutationRow({
      operation: "delete",
      payloadJson: JSON.stringify({ version: 3, deletedAt: "2026-07-22T11:00:00Z", updatedAt: "2026-07-22T11:00:00Z" }),
    })])
    mocks.update.mockResolvedValue({ error: null, count: 0 })
    mocks.insert.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.flushPending()

    expect(result.data?.failedMutations).toEqual([])
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1", deleted_at: "2026-07-22T11:00:00Z" }),
      { count: "exact" },
    )
    expect(mocks.applyCloudSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ id: "doc-1", cloudPresent: false, syncStatus: "deleted" }),
    ])
  })

  // ── ODE-404 regression (b): cloud_present=1 lands in the same flush ─────────

  it("marks cloud_present immediately after a verified INSERT without waiting for hydration", async () => {
    mocks.listPending.mockResolvedValue([mutationRow()])
    mocks.insert.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    await desktopCatalogSyncService.flushPending()

    expect(mocks.applyCloudSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ id: "doc-1", cloudPresent: true, syncStatus: "synced" }),
    ])
  })

  it("routes a second mutation for a doc inserted earlier in the same flush through UPDATE", async () => {
    mocks.listPending.mockResolvedValue([mutationRow({ id: "m1" }), mutationRow({ id: "m2" })])
    mocks.insert.mockResolvedValue({ error: null, count: 1 })
    mocks.update.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    const result = await desktopCatalogSyncService.flushPending()

    expect(result.data?.failedMutations).toEqual([])
    expect(mocks.insert).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledTimes(1)
  })

  // ── ODE-404 Performance Contract: reactive fan-out ──────────────────────────

  it("emits a single catalog batch for a flush that inserts N documents", async () => {
    mocks.catalogGet.mockImplementation(async (id: string) => catalogRecord({ id }))
    mocks.listPending.mockResolvedValue([
      mutationRow({ id: "m1", documentId: "doc-1" }),
      mutationRow({ id: "m2", documentId: "doc-2" }),
      mutationRow({ id: "m3", documentId: "doc-3" }),
    ])
    mocks.insert.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    await desktopCatalogSyncService.flushPending()

    expect(mocks.applyCloudSnapshots).toHaveBeenCalledTimes(1)
    expect(mocks.applyCloudSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({ id: "doc-1" }),
      expect.objectContaining({ id: "doc-2" }),
      expect.objectContaining({ id: "doc-3" }),
    ])
  })

  // ── ODE-404 regression (c): stalled queue recovers without an app restart ───

  it("recovers a stalled queue on the periodic tick after the initial flush dies", async () => {
    vi.useFakeTimers()
    mocks.getSession.mockRejectedValueOnce(new Error("token refresh failed"))
    mocks.listPending.mockResolvedValue([mutationRow()])
    mocks.insert.mockResolvedValue({ error: null, count: 1 })

    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    await desktopCatalogSyncService.start()

    // Initial flush dies early (session failure) — nothing is marked.
    const initial = await desktopCatalogSyncService.flushPending()
    expect(initial.error?.code).toBe("UNAVAILABLE")
    expect(mocks.updateStatus).not.toHaveBeenCalled()

    // Next periodic tick drains the queue without any new enqueue or restart.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      "/config/desktop-index.sqlite3", "m1", "synced", 0, null, null,
    )
    await desktopCatalogSyncService.stop()
  })

  it("keeps the idle tick silent: no cloud queries, no catalog events beyond the pending probe", async () => {
    vi.useFakeTimers()
    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    await desktopCatalogSyncService.start()

    await vi.advanceTimersByTimeAsync(180_000)

    expect(mocks.listPending).toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.applyCloudSnapshots).not.toHaveBeenCalled()
    await desktopCatalogSyncService.stop()
  })

  it("stops the periodic tick on stop()", async () => {
    vi.useFakeTimers()
    const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
    await desktopCatalogSyncService.start()
    await desktopCatalogSyncService.stop()

    await vi.advanceTimersByTimeAsync(180_000)
    expect(mocks.listPending).not.toHaveBeenCalled()
  })
})
