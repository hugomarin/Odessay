/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

let currentTestScope = "user-1"

const localDBMock = {
  writings: {
    get: vi.fn(),
    save: vi.fn(),
  },
  collections: {
    get: vi.fn(),
    save: vi.fn(),
  },
  writingCollections: {
    replaceForWriting: vi.fn(),
  },
  syncQueue: {
    getPending: vi.fn(),
    getCurrentForEntity: vi.fn(),
    markSynced: vi.fn(),
    markFailed: vi.fn(),
  },
}

const getSessionMock = vi.fn()
const tauriOpenFileMock = vi.fn()
const applyCloudSnapshotsMock = vi.fn()
const applyCloudSnapshotMock = vi.fn()

const writingsOrderMock = vi.fn()
const writingsInMock = vi.fn()
const writingsEqMock = vi.fn(() => ({ order: writingsOrderMock, in: writingsInMock }))
const writingsSelectMock = vi.fn(() => ({ eq: writingsEqMock }))
const writingsInsertMock = vi.fn(() => Promise.resolve({ error: null }))
const writingsUpdateEqAuthorMock = vi.fn(() => Promise.resolve({ error: null }))
const writingsUpdateEqIdMock = vi.fn(() => ({ eq: writingsUpdateEqAuthorMock }))
const writingsUpdateMock = vi.fn(() => ({ eq: writingsUpdateEqIdMock }))
const collectionsEqMock = vi.fn()
const collectionsSelectMock = vi.fn(() => ({ eq: collectionsEqMock }))
const writingCollectionsSelectMock = vi.fn()
const fromMock = vi.fn((table: string) => {
  if (table === "writings") {
    return {
      select: writingsSelectMock,
      insert: writingsInsertMock,
      update: writingsUpdateMock,
    }
  }

  if (table === "collections") {
    return { select: collectionsSelectMock }
  }

  if (table === "writing_collections") {
    return { select: writingCollectionsSelectMock }
  }

  throw new Error(`Unexpected table: ${table}`)
})

vi.mock("@/lib/local-db", () => ({
  localDB: localDBMock,
  getLocalDBScope: () => currentTestScope,
  setLocalDBScope: (scope?: string) => {
    currentTestScope = scope ?? "anonymous"
  },
}))

vi.mock("@/lib/services/auth-service-factory", () => ({
  getAuthService: () => ({
    getSession: getSessionMock,
  }),
}))

vi.mock("@/lib/services/web-sync-service", () => ({
  webSyncService: {
    enqueueMutation: vi.fn(),
  },
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    from: fromMock,
    auth: {
      getSession: getSessionMock,
    },
  }),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriOpenFile: tauriOpenFileMock,
}))

vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class {
    applyCloudSnapshots = applyCloudSnapshotsMock
    applyCloudSnapshot = applyCloudSnapshotMock
  },
}))

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(async () => "/tmp/config"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}))

describe("desktopSyncService", () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    currentTestScope = "user-1"

    localDBMock.writings.get.mockReset()
    localDBMock.writings.save.mockReset()
    localDBMock.collections.get.mockReset()
    localDBMock.collections.save.mockReset()
    localDBMock.writingCollections.replaceForWriting.mockReset()
    localDBMock.syncQueue.getPending.mockReset()
    localDBMock.syncQueue.getCurrentForEntity.mockReset()
    localDBMock.syncQueue.markSynced.mockReset()
    localDBMock.syncQueue.markFailed.mockReset()

    getSessionMock.mockReset()

    writingsOrderMock.mockReset()
    writingsInMock.mockReset()
    writingsEqMock.mockReset()
    writingsSelectMock.mockReset()
    writingsInsertMock.mockReset()
    writingsUpdateMock.mockReset()
    writingsUpdateEqIdMock.mockReset()
    writingsUpdateEqAuthorMock.mockReset()
    collectionsEqMock.mockReset()
    collectionsSelectMock.mockReset()
    writingCollectionsSelectMock.mockReset()
    tauriOpenFileMock.mockReset()
    applyCloudSnapshotsMock.mockReset().mockResolvedValue(undefined)
    applyCloudSnapshotMock.mockReset().mockResolvedValue(undefined)

    writingsEqMock.mockImplementation(() => ({ order: writingsOrderMock, in: writingsInMock }))
    writingsSelectMock.mockImplementation(() => ({ eq: writingsEqMock }))
    writingsInsertMock.mockImplementation(() => Promise.resolve({ error: null }))
    writingsUpdateEqAuthorMock.mockImplementation(() => Promise.resolve({ error: null }))
    writingsUpdateEqIdMock.mockImplementation(() => ({ eq: writingsUpdateEqAuthorMock }))
    writingsUpdateMock.mockImplementation(() => ({ eq: writingsUpdateEqIdMock }))
    collectionsSelectMock.mockImplementation(() => ({ eq: collectionsEqMock }))
  })

  it("hydrates remote writings on first authenticated desktop login and persists the device marker", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockResolvedValue(null)
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 3,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body",
        },
        {
          id: "writing-2",
          author_id: "user-1",
          title: "Beta",
          slug: "beta",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Beta body",
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      appliedCount: 2,
      hydratedIds: ["writing-1", "writing-2"],
    })
    expect(localDBMock.writings.save).toHaveBeenCalledTimes(2)
    expect(window.localStorage.getItem("odessay.desktop.hydrated.user-1")).toBe("1")
  })

  it("fetches zero bodies on a second startup when nothing changed (manifest only)", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    // Local already has both writings, synced, with matching content hashes and
    // up-to-date timestamps.
    const localById: Record<string, unknown> = {
      "writing-1": {
        id: "writing-1",
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: "hash-1",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      },
      "writing-2": {
        id: "writing-2",
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: "hash-2",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      },
    }
    localDBMock.writings.get.mockImplementation((id: string) =>
      Promise.resolve(localById[id] ?? null),
    )

    // Manifest carries only metadata — no body columns.
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          updated_at: "2026-06-02T00:00:00.000Z",
          content_hash: "hash-1",
          deleted_at: null,
          version: 1,
        },
        {
          id: "writing-2",
          updated_at: "2026-06-02T00:00:00.000Z",
          content_hash: "hash-2",
          deleted_at: null,
          version: 1,
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    expect(result.data).toEqual({ appliedCount: 0, hydratedIds: [] })
    // Only the manifest request was issued — no body fetch of any kind.
    expect(writingsSelectMock).toHaveBeenCalledTimes(1)
    expect(writingsInMock).not.toHaveBeenCalled()
    expect(localDBMock.writings.save).not.toHaveBeenCalled()
    expect(applyCloudSnapshotsMock).toHaveBeenCalledTimes(1)
    expect(applyCloudSnapshotsMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: "writing-1", contentHash: "hash-1", cloudAccountId: "user-1" }),
      expect.objectContaining({ id: "writing-2", contentHash: "hash-2", cloudAccountId: "user-1" }),
    ])
  })

  it("does not repeatedly fetch a body rejected by merge policy on desktop", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    let remoteHash = "remote-hash-a"
    let remoteUpdatedAt = "2026-06-04T00:00:00.000Z"
    const localById: Record<string, unknown> = {
      "writing-1": {
        id: "writing-1",
        author_id: "user-1",
        sync_status: "synced",
        lifecycle: "server-confirmed",
        version: 3,
        content_hash: "local-hash",
        updated_at: "2026-06-03T00:00:00.000Z",
        deleted_at: null,
        body_json: { type: "doc", content: [] },
        body_text: "Local version wins",
      },
      "writing-2": {
        id: "writing-2",
        author_id: "user-1",
        sync_status: "synced",
        lifecycle: "server-confirmed",
        version: 1,
        content_hash: "stable-hash",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
        body_json: { type: "doc", content: [] },
        body_text: "Already current",
      },
    }

    localDBMock.writings.get.mockImplementation((id: string) =>
      Promise.resolve(localById[id] ?? null),
    )
    localDBMock.writings.save.mockImplementation((writing: { id: string }) => {
      localById[writing.id] = writing
      return Promise.resolve()
    })
    writingsOrderMock.mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: "writing-1",
            updated_at: remoteUpdatedAt,
            content_hash: remoteHash,
            deleted_at: null,
            version: 2,
          },
          {
            id: "writing-2",
            updated_at: "2026-06-02T00:00:00.000Z",
            content_hash: "stable-hash",
            deleted_at: null,
            version: 1,
          },
        ],
        error: null,
      }),
    )
    writingsInMock.mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: "writing-1",
            author_id: "user-1",
            title: "Remote",
            slug: "remote",
            status: "draft",
            visibility: "private",
            parent_id: null,
            correspondence_id: null,
            version: 2,
            content_hash: remoteHash,
            deleted_at: null,
            created_at: "2026-06-01T00:00:00.000Z",
            updated_at: remoteUpdatedAt,
            body_json: { type: "doc", content: [] },
            body_text: "Remote body",
          },
        ],
        error: null,
      }),
    )

    const { desktopSyncService, invalidateHydrationFreshness } = await import(
      "@/lib/sync/desktop-sync-service"
    )

    const first = await desktopSyncService.hydrateWritings()
    expect(first.error).toBeNull()
    expect(first.data).toEqual({ appliedCount: 0, hydratedIds: [] })
    expect(writingsInMock).toHaveBeenCalledTimes(1)
    expect(localById["writing-1"]).toMatchObject({
      body_text: "Local version wins",
      remote_body_rejection: {
        content_hash: "remote-hash-a",
        version: 2,
        updated_at: "2026-06-04T00:00:00.000Z",
      },
    })

    invalidateHydrationFreshness("user-1")
    const second = await desktopSyncService.hydrateWritings()
    expect(second.error).toBeNull()
    expect(writingsSelectMock).toHaveBeenCalledTimes(3)
    expect(writingsInMock).toHaveBeenCalledTimes(1)

    remoteHash = "remote-hash-b"
    remoteUpdatedAt = "2026-06-05T00:00:00.000Z"
    invalidateHydrationFreshness("user-1")
    const third = await desktopSyncService.hydrateWritings()
    expect(third.error).toBeNull()
    expect(writingsInMock).toHaveBeenCalledTimes(2)
  })

  it("fetches exactly the changed ids when a subset changed (2 of N)", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    // writing-1 unchanged; writing-2 and writing-3 have new remote hashes.
    const localById: Record<string, unknown> = {
      "writing-1": {
        id: "writing-1",
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: "hash-1",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      },
      "writing-2": {
        id: "writing-2",
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: "hash-2-old",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      },
      "writing-3": {
        id: "writing-3",
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: "hash-3-old",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      },
    }
    localDBMock.writings.get.mockImplementation((id: string) =>
      Promise.resolve(localById[id] ?? null),
    )

    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          updated_at: "2026-06-02T00:00:00.000Z",
          content_hash: "hash-1",
          deleted_at: null,
          version: 1,
        },
        {
          id: "writing-2",
          updated_at: "2026-06-03T00:00:00.000Z",
          content_hash: "hash-2-new",
          deleted_at: null,
          version: 2,
        },
        {
          id: "writing-3",
          updated_at: "2026-06-03T00:00:00.000Z",
          content_hash: "hash-3-new",
          deleted_at: null,
          version: 2,
        },
      ],
      error: null,
    })

    // Phase 2 batch fetch (.in) returns full bodies for the requested ids only.
    writingsInMock.mockResolvedValue({
      data: [
        {
          id: "writing-2",
          author_id: "user-1",
          title: "Beta",
          slug: "beta",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          content_hash: "hash-2-new",
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-03T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Beta body v2",
        },
        {
          id: "writing-3",
          author_id: "user-1",
          title: "Gamma",
          slug: "gamma",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          content_hash: "hash-3-new",
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-03T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Gamma body v2",
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      appliedCount: 2,
      hydratedIds: ["writing-2", "writing-3"],
    })
    // Phase 2 asked for exactly the two changed ids via a bounded .in(...) query.
    expect(writingsInMock).toHaveBeenCalledTimes(1)
    expect(writingsInMock).toHaveBeenCalledWith("id", ["writing-2", "writing-3"])
    expect(localDBMock.writings.save).toHaveBeenCalledTimes(2)
  })

  it("chunks the phase-2 .in(...) fetch when a large subset changed", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    // writing-0 is unchanged so this is a partial subset (not the all-changed
    // single-list fallback); the remaining 250 have new remote hashes and
    // exceed the 200-id batch cap.
    const total = 251
    const manifest = Array.from({ length: total }, (_, index) => ({
      id: `writing-${index}`,
      updated_at: index === 0 ? "2026-06-02T00:00:00.000Z" : "2026-06-03T00:00:00.000Z",
      content_hash: index === 0 ? "hash-0" : `hash-${index}-new`,
      deleted_at: null,
      version: 2,
    }))

    localDBMock.writings.get.mockImplementation((id: string) => {
      const index = Number(id.split("-")[1])
      return Promise.resolve({
        id,
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: `hash-${index}`,
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      })
    })

    writingsOrderMock.mockResolvedValue({ data: manifest, error: null })

    const inCalls: string[][] = []
    writingsInMock.mockImplementation((_column: string, ids: string[]) => {
      inCalls.push(ids)
      return Promise.resolve({
        data: ids.map((id) => ({
          id,
          author_id: "user-1",
          title: id,
          slug: id,
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          content_hash: `${id.replace("writing-", "hash-")}-new`,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-03T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: `${id} body`,
        })),
        error: null,
      })
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    expect(result.data?.appliedCount).toBe(250)
    // 250 changed ids with a 200-id cap ⇒ two .in(...) batches (200 + 50).
    expect(inCalls).toHaveLength(2)
    expect(inCalls[0]).toHaveLength(200)
    expect(inCalls[1]).toHaveLength(50)
    expect(localDBMock.writings.save).toHaveBeenCalledTimes(250)
  })

  it("reflects a remote soft-delete surfaced only in the manifest", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockImplementation((id: string) =>
      Promise.resolve(
        id === "writing-1"
          ? {
              id: "writing-1",
              author_id: "user-1",
              sync_status: "synced",
              version: 1,
              content_hash: "hash-1",
              updated_at: "2026-06-02T00:00:00.000Z",
              deleted_at: null,
            }
          : null,
      ),
    )

    // Manifest reports writing-1 as remotely soft-deleted (deleted_at + bumped
    // version). No body fetch is needed to reflect this.
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          updated_at: "2026-06-04T00:00:00.000Z",
          content_hash: "hash-1",
          deleted_at: "2026-06-04T00:00:00.000Z",
          version: 2,
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      appliedCount: 1,
      hydratedIds: ["writing-1"],
    })
    // Delete is applied from manifest metadata alone — no body fetch.
    expect(writingsInMock).not.toHaveBeenCalled()
    expect(localDBMock.writings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "writing-1",
        sync_status: "deleted",
        deleted_at: "2026-06-04T00:00:00.000Z",
      }),
    )
  })

  it("lets a concurrent local edit win over the phase-2 body (race)", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    // First read (manifest decision) sees a clean synced row → schedule a body
    // fetch. Second read (merge) sees the row the user just edited locally
    // (pending) → shouldApplyRemoteWriting must reject the remote body.
    localDBMock.writings.get
      .mockResolvedValueOnce({
        id: "writing-1",
        author_id: "user-1",
        sync_status: "synced",
        version: 1,
        content_hash: "hash-1-old",
        updated_at: "2026-06-02T00:00:00.000Z",
        deleted_at: null,
      })
      .mockResolvedValueOnce({
        id: "writing-1",
        author_id: "user-1",
        sync_status: "pending",
        version: 1,
        content_hash: "hash-1-local-edit",
        updated_at: "2026-06-05T00:00:00.000Z",
        deleted_at: null,
      })

    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          content_hash: "hash-1-remote",
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-03T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body remote",
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    // The locally-edited (pending) row wins; the remote body is discarded.
    expect(result.data).toEqual({ appliedCount: 0, hydratedIds: [] })
    expect(localDBMock.writings.save).not.toHaveBeenCalled()
  })

  it("does not start remote sync work on desktop when there is no authenticated user", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const runtimeState = await desktopSyncService.getRuntimeState()
    const scheduleResult = await desktopSyncService.scheduleFlush()
    const startResult = await desktopSyncService.start()

    expect(runtimeState.data).toEqual({
      status: "idle",
      pendingMutations: 0,
      nextRetryAt: null,
      lastSyncedAt: null,
    })
    expect(scheduleResult.error).toBeNull()
    expect(startResult.error).toBeNull()
  })

  it("flushes pending desktop writing mutations directly to Supabase without web routes", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.syncQueue.getPending
      .mockResolvedValueOnce([
        {
          id: "mutation-1",
          entity_kind: "writing",
          entity_id: "writing-1",
          entity_key: "writing:writing-1",
          operation: "upsert",
          payload: {
            author_id: null,
            title: "Desktop draft",
            body_json: { type: "doc", content: [] },
            body_text: "Desktop draft body",
            slug: null,
            status: "draft",
            visibility: "private",
            parent_id: null,
            correspondence_id: null,
            version: 1,
            updated_at: "2026-06-02T00:00:00.000Z",
            deleted_at: null,
          },
          created_at: Date.now(),
          attempts: 0,
        },
      ])
      .mockResolvedValueOnce([])

    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      author_id: "user-1",
      title: "Desktop draft",
      sync_status: "pending",
      lifecycle: "local-only",
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.flushPending()

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      processedMutations: 1,
      failedMutations: [],
      nextRetryAt: null,
    })
    // Plain INSERT (return=minimal) — NOT upsert/on_conflict, which trips a 42501
    // RLS error on this project. And author_id is pinned to the authenticated
    // user even though the queued payload carries author_id: null.
    expect(writingsInsertMock).toHaveBeenCalledTimes(1)
    expect(writingsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "writing-1", author_id: "user-1" }),
    )
    expect(localDBMock.syncQueue.markSynced).toHaveBeenCalledWith("mutation-1")
    // Local row is flipped to synced/server-confirmed (no remote re-map).
    expect(localDBMock.writings.save).toHaveBeenCalledWith(
      expect.objectContaining({ sync_status: "synced", lifecycle: "server-confirmed" }),
    )
  })

  it("rebuilds the cloud payload from the canonical markdown file when canonical_path exists", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    tauriOpenFileMock.mockResolvedValue(`---
id: writing-1
slug: canonical-slug
status: draft
visibility: private
version: 4
created_at: 2026-06-01T00:00:00.000Z
updated_at: 2026-06-03T00:00:00.000Z
---

# Canonical title

Body from markdown truth.`)

    localDBMock.syncQueue.getPending
      .mockResolvedValueOnce([
        {
          id: "mutation-1",
          entity_kind: "writing",
          entity_id: "writing-1",
          entity_key: "writing:writing-1",
          operation: "upsert",
          payload: {
            author_id: null,
            title: "Stale cache title",
            body_json: { type: "doc", content: [] },
            body_text: "Stale cache body",
            slug: null,
            status: "draft",
            visibility: "private",
            parent_id: null,
            correspondence_id: null,
            version: 2,
            updated_at: "2026-06-02T00:00:00.000Z",
            deleted_at: null,
          },
          created_at: Date.now(),
          attempts: 0,
        },
      ])
      .mockResolvedValueOnce([])

    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      canonical_path: "/docs/writing-1.md",
      author_id: "user-1",
      title: "Cached title",
      sync_status: "pending",
      lifecycle: "local-only",
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const result = await desktopSyncService.flushPending()

    expect(result.error).toBeNull()
    expect(tauriOpenFileMock).toHaveBeenCalledWith("/docs/writing-1.md")
    expect(writingsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "writing-1",
        title: "writing-1",
        slug: null,
        body_text: expect.stringContaining("id: writing-1"),
        version: 2,
        updated_at: "2026-06-02T00:00:00.000Z",
      }),
    )
    expect(localDBMock.writings.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: "writing-1", sync_status: "synced" }),
    )
  })

  it("shares a single request across concurrent hydrateWritings callers", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockResolvedValue(null)
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body",
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const [r1, r2, r3] = await Promise.all([
      desktopSyncService.hydrateWritings(),
      desktopSyncService.hydrateWritings(),
      desktopSyncService.hydrateWritings(),
    ])

    // Single-flight still collapses the 3 callers into one hydration; that one
    // hydration issues exactly 2 writings requests (manifest + bodies).
    expect(writingsSelectMock).toHaveBeenCalledTimes(2)
    expect(r1.data?.appliedCount).toBe(1)
    expect(r2.data?.appliedCount).toBe(1)
    expect(r3.data?.appliedCount).toBe(1)
  })

  it("reuses local state for sequential hydrateWritings callers inside the freshness window", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockResolvedValue(null)
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body",
        },
      ],
      error: null,
    })

    const nowSpy = vi.spyOn(Date, "now")
    const baseTime = 1_000_000
    nowSpy.mockReturnValue(baseTime)

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const first = await desktopSyncService.hydrateWritings()
    expect(first.data?.appliedCount).toBe(1)
    // First hydration: manifest + bodies = 2 requests.
    expect(writingsSelectMock).toHaveBeenCalledTimes(2)

    // Advance time but stay inside the 45 s freshness window.
    nowSpy.mockReturnValue(baseTime + 30_000)
    const second = await desktopSyncService.hydrateWritings()
    expect(second.data?.appliedCount).toBe(0)
    // Reused from the freshness window — no new requests.
    expect(writingsSelectMock).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
  })

  it("issues a new request when the freshness window has expired", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockResolvedValue(null)
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body",
        },
      ],
      error: null,
    })

    const nowSpy = vi.spyOn(Date, "now")
    const baseTime = 1_000_000
    nowSpy.mockReturnValue(baseTime)

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    await desktopSyncService.hydrateWritings()
    // First hydration: manifest + bodies = 2 requests.
    expect(writingsSelectMock).toHaveBeenCalledTimes(2)

    nowSpy.mockReturnValue(baseTime + 50_000)
    await desktopSyncService.hydrateWritings()
    // Window expired: a second full hydration issues 2 more requests.
    expect(writingsSelectMock).toHaveBeenCalledTimes(4)

    nowSpy.mockRestore()
  })

  it("does not share in-flight promises or freshness across different users", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockResolvedValue(null)
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body",
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    await desktopSyncService.hydrateWritings()
    // First user hydration: manifest + bodies = 2 requests.
    expect(writingsSelectMock).toHaveBeenCalledTimes(2)

    // Switch to a different user. The freshness window of user-1 must not apply.
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
      error: null,
    })
    currentTestScope = "user-2"

    const result = await desktopSyncService.hydrateWritings()
    expect(result.data?.appliedCount).toBe(1)
    // Second user hydrates fresh: 2 more requests.
    expect(writingsSelectMock).toHaveBeenCalledTimes(4)
  })

  it("aborts hydration when the local scope is no longer active", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    localDBMock.writings.get.mockResolvedValue(null)
    writingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Alpha",
          slug: "alpha",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          deleted_at: null,
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          body_json: { type: "doc", content: [] },
          body_text: "Alpha body",
        },
      ],
      error: null,
    })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    // Simulate that the user signed out before the response was applied: the
    // session still says user-1, but the local DB scope has been cleared.
    currentTestScope = "anonymous"

    const result = await desktopSyncService.hydrateWritings()

    expect(result.error).toBeNull()
    expect(result.data?.appliedCount).toBe(0)
    expect(localDBMock.writings.save).not.toHaveBeenCalled()
  })

  it("shares a single request across concurrent hydrateCollections callers", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    collectionsEqMock.mockResolvedValue({
      data: [
        {
          id: "collection-1",
          owner_id: "user-1",
          name: "Alpha",
          description: null,
          visibility: "private",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
        },
      ],
      error: null,
    })
    writingCollectionsSelectMock.mockResolvedValue({ data: [], error: null })
    localDBMock.collections.get.mockResolvedValue(null)
    localDBMock.syncQueue.getCurrentForEntity.mockResolvedValue(null)

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const [r1, r2, r3] = await Promise.all([
      desktopSyncService.hydrateCollections(),
      desktopSyncService.hydrateCollections(),
      desktopSyncService.hydrateCollections(),
    ])

    expect(collectionsSelectMock).toHaveBeenCalledTimes(1)
    expect(r1.data?.appliedCount).toBe(1)
    expect(r2.data?.appliedCount).toBe(1)
    expect(r3.data?.appliedCount).toBe(1)
  })

  it("reuses local state for sequential hydrateCollections callers inside the freshness window", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    collectionsEqMock.mockResolvedValue({
      data: [
        {
          id: "collection-1",
          owner_id: "user-1",
          name: "Alpha",
          description: null,
          visibility: "private",
          created_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
        },
      ],
      error: null,
    })
    writingCollectionsSelectMock.mockResolvedValue({ data: [], error: null })
    localDBMock.collections.get.mockResolvedValue(null)
    localDBMock.syncQueue.getCurrentForEntity.mockResolvedValue(null)

    const nowSpy = vi.spyOn(Date, "now")
    const baseTime = 2_000_000
    nowSpy.mockReturnValue(baseTime)

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const first = await desktopSyncService.hydrateCollections()
    expect(first.data?.appliedCount).toBe(1)
    expect(collectionsSelectMock).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(baseTime + 30_000)
    const second = await desktopSyncService.hydrateCollections()
    expect(second.data?.appliedCount).toBe(0)
    expect(collectionsSelectMock).toHaveBeenCalledTimes(1)

    nowSpy.mockRestore()
  })

  it("clears the single-flight guard and skips the freshness window after a network failure", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })

    writingsOrderMock
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValue({
        data: [
          {
            id: "writing-1",
            author_id: "user-1",
            title: "Alpha",
            slug: "alpha",
            status: "draft",
            visibility: "private",
            parent_id: null,
            correspondence_id: null,
            version: 1,
            deleted_at: null,
            created_at: "2026-06-01T00:00:00.000Z",
            updated_at: "2026-06-02T00:00:00.000Z",
            body_json: { type: "doc", content: [] },
            body_text: "Alpha body",
          },
        ],
        error: null,
      })

    const { desktopSyncService } = await import("@/lib/sync/desktop-sync-service")

    const first = await desktopSyncService.hydrateWritings()
    expect(first.error).not.toBeNull()
    // Phase 1 (manifest) failed before phase 2 ran: exactly 1 request issued.
    expect(writingsOrderMock).toHaveBeenCalledTimes(1)

    // Immediately retry: the failed hydration must not mark the window fresh,
    // so the next call issues real requests (manifest + bodies).
    const second = await desktopSyncService.hydrateWritings()
    expect(second.error).toBeNull()
    expect(second.data?.appliedCount).toBe(1)
    expect(writingsOrderMock).toHaveBeenCalledTimes(3)
  })
})
