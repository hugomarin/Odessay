/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-373 — Desk/Workspace consume DocumentCatalog in production
 * @doc workflow/context/features/odessay-desktop-document-catalog.md §Desk y Workspace como vistas del catálogo
 *
 * Mounts the REAL Desk page and the REAL Workspace detail over one mocked
 * DocumentCatalog and asserts:
 *   - base membership comes from the catalog (a catalog-only record renders; a
 *     local-only writing that is NOT in the catalog does not),
 *   - the rendered document state is the catalog-derived state,
 *   - a catalog change burst updates the mounted surface (watcher discovery),
 *   - the same UUID shows the same state in Desk and Workspace.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { LocalWriting } from "@/lib/local-db/schema"
import { loadSearchWritings } from "@/lib/queries/desk-catalog-source"
import { changeWritingStatus } from "@/lib/queries/writing-mutations"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ----------------------------- shared fakes ------------------------------ */

const catalog = vi.hoisted(() => {
  const listeners = new Set<(change: unknown) => void>()
  const state: {
    records: unknown[]
    blockNextList: Promise<void> | null
    /** Catalog reads in flight; the Desk bootstrap barrier waits on this. */
    pendingLists: number
  } = { records: [], blockNextList: null, pendingLists: 0 }
  return {
    state,
    listeners,
    /**
     * Publishes a CatalogChange with the same call forms the real catalog uses:
     * `emit(documentIds, reason)` for the emitters (cloud snapshots, bindings,
     * bulk dual writes) and `emit()` for a generic burst. The change shape is
     * the real one (`lib/services/contracts/document-catalog.ts`), so a
     * subscriber that inspects `reason`/`documentIds` behaves as in production.
     */
    emit(
      documentIds?: string[],
      reason?: "upsert" | "detach" | "cloud-snapshot" | "migration" | "bulk" | "excerpt" | "content",
    ) {
      const change = {
        transactionId: "t",
        documentIds: documentIds ?? [],
        reason: reason ?? "bulk",
        occurredAt: Date.now(),
      }
      listeners.forEach((listener) => listener(change))
    },
    instance: {
      list: vi.fn(async () => {
        state.pendingLists += 1
        try {
          if (state.blockNextList) {
            const blocker = state.blockNextList
            state.blockNextList = null
            await blocker
          }
          return state.records
        } finally {
          state.pendingLists -= 1
        }
      }),
      getById: async (id: string) =>
        (state.records as DocumentCatalogRecord[]).find((r) => r.id === id) ?? null,
      resolvePath: async (path: string) => ({ kind: "unbound", path }),
      registerBinding: vi.fn(),
      detachLocalFile: vi.fn(),
      /**
       * Real hydration boundary (ODE-623 P1): production merges the cloud rows
       * and then publishes ONE `cloud-snapshot` CatalogChange
       * (`lib/services/desktop/sqlite-document-catalog.ts:136-156`), which Desk
       * debounces exactly like the membership event. The single-snapshot form
       * delegates to the batch one, mirroring `applyCloudSnapshot`.
       */
      applyCloudSnapshot: vi.fn(async (snapshot: DocumentCatalogRecord) => {
        await catalog.instance.applyCloudSnapshots([snapshot])
      }),
      applyCloudSnapshots: vi.fn(async (snapshots: DocumentCatalogRecord[]) => {
        for (const snapshot of snapshots) {
          const index = (state.records as DocumentCatalogRecord[]).findIndex((r) => r.id === snapshot.id)
          if (index >= 0) {
            state.records[index] = { ...(state.records[index] as DocumentCatalogRecord), ...snapshot }
          } else {
            state.records = [...state.records, snapshot]
          }
        }
        catalog.emit(
          snapshots.map((snapshot) => snapshot.id),
          "cloud-snapshot",
        )
      }),
      subscribe: (listener: (change: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
})

const storage = vi.hoisted(() => ({ writings: [] as LocalWriting[] }))
const localScope = vi.hoisted(() => ({ value: "anonymous" as string }))
const authSession = vi.hoisted(() => ({ userId: null as string | null }))
const collectionStore = vi.hoisted(() => ({
  state: { collections: [] as unknown[], writingCollections: [] as unknown[] },
  load: vi.fn(),
  set: vi.fn(),
}))

vi.mock("@/lib/services/document-catalog-factory", () => ({
  getDocumentCatalog: async () => catalog.instance,
}))

// Desktop runtime + catalog dual-write on: exercises the catalog read path and
// lets the desktop-only Workspace shell render. (Desk itself is runtime-agnostic
// and uses @/lib/runtime/detect, which stays web here.)
vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/local-db", () => ({
  localDB: {
    writings: {
      getAll: async () => storage.writings,
      get: async (id: string) => storage.writings.find((w) => w.id === id) ?? null,
    },
    collections: { getAll: async () => [] },
    writingCollections: { listAll: async () => [] },
  },
  getLocalDBScope: () => localScope.value,
  subscribeToLocalDBScopeChanges: () => () => {},
  subscribeToLocalDBChanges: () => () => {},
}))

vi.mock("@/lib/local-db/collections", () => ({
  createLocalCollection: vi.fn(),
  deleteLocalCollection: vi.fn(),
  setLocalWritingCollections: vi.fn(),
  updateLocalCollection: vi.fn(),
}))

vi.mock("@/lib/services/desktop/desktop-collection-service", () => ({
  loadDesktopCollections: collectionStore.load,
  createDesktopCollection: vi.fn(),
  deleteDesktopCollection: vi.fn(),
  setDesktopWritingCollections: collectionStore.set,
  updateDesktopCollection: vi.fn(),
}))

const pushMock = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/desk",
}))

// Desk service dependencies — stubbed to no-ops so the mount exercises the
// catalog data path, not the network.
vi.mock("@/lib/services/sharing-service-factory", () => ({
  createSharingService: () => ({
    listIncomingShares: async () => ({ data: [], error: null }),
    listRecipientPreviews: async () => ({ data: {}, error: null }),
    getPreviewLink: async () => ({ data: null, error: null }),
    rotatePreviewLink: async () => ({ data: null, error: null }),
  }),
}))
const sync = vi.hoisted(() => ({
  blockHydration: false,
  /**
   * Holds the background hydration pass until the test releases it. Production
   * hydration is a network roundtrip that lands after the mount-local work has
   * settled; the gate lets the test pick that same ordering instead of racing
   * the effect churn of a warm module graph (ODE-623).
   */
  hydrationGate: null as Promise<void> | null,
  /**
   * Remote record the hydration double merges into the catalog when it runs.
   * Production hydration pulls remote rows in and the reload that follows it
   * renders them; a test sets this to observe that reload completed (ODE-623).
   */
  hydratedRecord: null as DocumentCatalogRecord | null,
}))
vi.mock("@/lib/sync", () => ({
  getSyncService: () => ({
    // When blocked, cloud hydration never resolves — Desk must still render its
    // local catalog rows (local-first / TTI not gated on the network).
    hydrateWritings: async () => {
      if (sync.blockHydration) return new Promise(() => {})
      if (sync.hydrationGate) await sync.hydrationGate
      if (sync.hydratedRecord) {
        const record = sync.hydratedRecord
        sync.hydratedRecord = null
        // Production hydrates through applyCloudSnapshots, which commits the
        // row THEN publishes the `cloud-snapshot` CatalogChange (ODE-623 P1).
        await catalog.instance.applyCloudSnapshots([record])
      }
      return { data: null }
    },
    hydrateCollections: () =>
      sync.blockHydration ? new Promise(() => {}) : Promise.resolve({ data: null }),
    scheduleFlush: () => {},
  }),
}))
vi.mock("@/lib/sync/queue", () => ({
  enqueueWritingUpsert: vi.fn(async (writing: { id: string; status: string; artifact_type: string; version: number }) => {
    const record = (catalog.state.records as DocumentCatalogRecord[]).find((r) => r.id === writing.id)
    if (record) {
      record.status = writing.status as DocumentCatalogRecord["status"]
      record.artifactType = writing.artifact_type as DocumentCatalogRecord["artifactType"]
      record.version = writing.version
      record.modifiedAt = Date.now()
    }
    catalog.emit()
  }),
  enqueueWritingDelete: vi.fn(async (writingId: string) => {
    const record = (catalog.state.records as DocumentCatalogRecord[]).find((r) => r.id === writingId)
    if (record) {
      record.deletedAt = new Date().toISOString()
      record.localPresent = false
    }
    catalog.emit()
  }),
}))
vi.mock("@/lib/sync/remote-bootstrap", () => ({ invalidateWebWritingsHydrationFreshness: vi.fn() }))
vi.mock("@/lib/collections/remote-bootstrap", () => ({ invalidateWebCollectionsHydrationFreshness: vi.fn() }))
vi.mock("@/lib/services/desktop-auth-service", () => ({
  getStoredDesktopSessionUser: async () =>
    authSession.userId ? { id: authSession.userId } : null,
  desktopAuthService: {
    getSession: async () => ({
      data: { user: authSession.userId ? { id: authSession.userId } : null },
      error: null,
    }),
  },
}))
vi.mock("@/lib/services/document-service-factory", () => ({
  getDocumentService: async () => ({
    exportWriting: async () => ({ data: null, error: null }),
    updateWritingMetadata: async (input: {
      writingId: string
      status?: DocumentCatalogRecord["status"]
      artifactType?: DocumentCatalogRecord["artifactType"]
      version: number
    }) => {
      const record = (catalog.state.records as DocumentCatalogRecord[]).find((row) => row.id === input.writingId)
      if (!record) return { data: null, error: { code: "NOT_FOUND", message: "Missing", retryable: false } }
      if (input.status) record.status = input.status
      if (input.artifactType) record.artifactType = input.artifactType
      record.version = input.version
      record.modifiedAt = Date.now()
      catalog.emit()
      return { data: record, error: null }
    },
    updateWritingsMetadata: async (input: { updates: Array<{
      writingId: string
      status?: DocumentCatalogRecord["status"]
      artifactType?: DocumentCatalogRecord["artifactType"]
      version: number
    }> }) => {
      const updated: DocumentCatalogRecord[] = []
      for (const change of input.updates) {
        const record = (catalog.state.records as DocumentCatalogRecord[]).find((row) => row.id === change.writingId)
        if (!record) return { data: null, error: { code: "NOT_FOUND", message: "Missing", retryable: false } }
        if (change.status) record.status = change.status
        if (change.artifactType) record.artifactType = change.artifactType
        record.version = change.version
        record.modifiedAt = Date.now()
        updated.push(record)
      }
      catalog.emit()
      return { data: updated, error: null }
    },
  }),
}))
vi.mock("@/lib/services/workspace-service", () => ({
  getWorkspaceAssignmentService: () => ({
    isAvailable: false,
    listWorkspaces: async () => [],
    listAssignments: async () => ({}),
    assign: async () => {},
    clearAssignment: async () => {},
    createWorkspace: async () => null,
  }),
}))

// Workspace detail dependencies.
const workspaceDetail = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/lib/services/desktop/workspace-service", () => ({
  getDesktopWorkspaceService: async () => ({
    getWorkspace: async () => workspaceDetail.current,
    markWorkspaceOpened: async () => {},
    watchWorkspace: async () => async () => {},
  }),
}))
vi.mock("@/lib/services/open-document-factory", () => ({
  isUnifiedOpenEnabled: () => false,
  openDocumentById: async () => ({ status: "opened", documentId: "x" }),
  openDocumentByIdWithRetry: async () => ({
    result: { status: "opened", documentId: "x" },
    attempt: 1,
  }),
  openDocumentByPath: async () => ({ status: "opened", documentId: "x" }),
  describeOpenOutcome: () => "",
}))

const makeRecord = (partial: Partial<DocumentCatalogRecord>): DocumentCatalogRecord => ({
  id: partial.id ?? "doc",
  localPresent: partial.localPresent ?? true,
  cloudPresent: partial.cloudPresent ?? false,
  cloudAccountId: partial.cloudAccountId ?? null,
  syncStatus: partial.syncStatus ?? "local-only",
  title: partial.title ?? "Doc",
  slug: partial.slug ?? null,
  status: partial.status ?? "draft",
  artifactType: partial.artifactType ?? "general",
  visibility: partial.visibility ?? "private",
  version: partial.version ?? 1,
  deletedAt: partial.deletedAt ?? null,
  createdAt: partial.createdAt ?? 1000,
  modifiedAt: partial.modifiedAt ?? 2000,
  excerpt: partial.excerpt ?? null,
  binding: partial.binding ?? null,
})

const makeWriting = (partial: Partial<LocalWriting>): LocalWriting => ({
  id: partial.id ?? "doc",
  title: partial.title ?? "Doc",
  canonical_path: partial.canonical_path ?? null,
  body_json: {},
  body_text: partial.body_text ?? "",
  status: partial.status ?? "draft",
  visibility: partial.visibility ?? "private",
  version: 1,
  sync_status: partial.sync_status ?? "synced",
  lifecycle: partial.lifecycle ?? "local-only",
  created_at: "2026-06-18T00:00:00.000Z",
  updated_at: "2026-06-18T00:00:00.000Z",
  local_updated_at: 1,
})

const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

// Wait past a real timer (the catalog subscription coalesces bursts with a 100ms
// debounce) and then flush the resulting async reload.
const waitPastDebounce = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 160))
  })
  await flush()
}

let container: HTMLDivElement
let root: Root | null = null

// The membership test drives the product debounce with vitest fake timers, so
// the polling barrier keeps the real timer and clock captured at module load:
// its short real turns let dynamic imports and microtask chains settle without
// ever advancing the debounce it is measuring (ODE-623 P1).
const realSetTimeout = globalThis.setTimeout.bind(globalThis)
const realDateNow = Date.now.bind(Date)

/**
 * Wait for a condition the mounted Desk surface makes observable, without a
 * fixed sleep. The catalog debounce and the hydration reload are real timers,
 * so the poll yields in short real turns; the failure message carries the
 * catalog counters so a missing refresh is attributable (ODE-623).
 */
const waitForDesk = async (
  predicate: () => unknown,
  label: string,
  timeoutMs = 2000,
): Promise<void> => {
  const deadline = realDateNow() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (realDateNow() >= deadline) {
      throw new Error(
        `waitForDesk agotó ${timeoutMs}ms esperando: ${label} (catalog.list=${catalog.instance.list.mock.calls.length}, collectionStore.load=${collectionStore.load.mock.calls.length}, pendingLists=${catalog.state.pendingLists})`,
      )
    }
    await act(async () => {
      await new Promise((resolve) => realSetTimeout(resolve, 10))
    })
  }
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  catalog.state.records = []
  catalog.state.blockNextList = null
  catalog.state.pendingLists = 0
  catalog.listeners.clear()
  storage.writings = []
  localScope.value = "anonymous"
  authSession.userId = null
  collectionStore.state = { collections: [], writingCollections: [] }
  collectionStore.load.mockImplementation(async () => collectionStore.state)
  collectionStore.set.mockImplementation(async (writingId: string, collectionIds: string[]) => {
    collectionStore.state.writingCollections = collectionIds.map((collectionId) => ({
      writing_id: writingId,
      collection_id: collectionId,
      added_at: "2026-07-18T00:00:00.000Z",
      local_updated_at: 1,
    }))
  })
  sync.blockHydration = false
  sync.hydrationGate = null
  sync.hydratedRecord = null
  pushMock.mockReset()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container.remove()
  vi.clearAllMocks()
})

describe("Desk consumes the DocumentCatalog", () => {
  it("loads Search results from the catalog and excludes local-only stragglers", async () => {
    catalog.state.records = [
      makeRecord({ id: "catalog-search", title: "Catalog Search", excerpt: "Searchable catalog excerpt" }),
      makeRecord({ id: "deleted-search", title: "Deleted Search", deletedAt: "2026-07-18T00:00:00.000Z" }),
    ]
    storage.writings = [makeWriting({ id: "straggler-search", title: "Local Straggler", body_text: "legacy" })]

    const results = await loadSearchWritings()

    expect(results).toEqual([
      expect.objectContaining({
        id: "catalog-search",
        title: "Catalog Search",
        body_text: "Searchable catalog excerpt",
      }),
    ])
    expect(catalog.instance.list).toHaveBeenCalledWith({ cloudAccountId: null, limit: 10_000 })
  })

  it("scopes desktop Search to the authenticated cloud account", async () => {
    authSession.userId = "account-1"
    catalog.state.records = [
      makeRecord({
        id: "cloud-search",
        title: "Cloud Search Result",
        localPresent: false,
        cloudPresent: true,
        cloudAccountId: "account-1",
        syncStatus: "synced",
      }),
    ]

    const results = await loadSearchWritings()

    expect(catalog.instance.list).toHaveBeenCalledWith({ cloudAccountId: "account-1", limit: 10_000 })
    expect(results).toEqual([
      expect.objectContaining({
        id: "cloud-search",
        title: "Cloud Search Result",
      }),
    ])
  })

  it("includes cloud-only rows for the authenticated desktop account", async () => {
    authSession.userId = "account-1"
    catalog.state.records = [
      makeRecord({
        id: "cloud-restored",
        title: "Restored cloud writing",
        localPresent: false,
        cloudPresent: true,
        cloudAccountId: "account-1",
        syncStatus: "synced",
      }),
    ]

    const { loadDeskCatalogData } = await import("@/lib/queries/desk-catalog-source")
    const result = await loadDeskCatalogData()

    expect(catalog.instance.list).toHaveBeenCalledWith({
      cloudAccountId: "account-1",
      limit: 10_000,
    })
    expect(result.writings).toEqual([
      expect.objectContaining({
        id: "cloud-restored",
        lifecycle: "server-confirmed",
      }),
    ])
  })

  it("renders the catalog base set and its state, not the local-only stragglers", async () => {
    catalog.state.records = [
      makeRecord({
        id: "cat-local",
        title: "Catalog Local Doc",
        localPresent: true,
        cloudPresent: false,
        syncStatus: "local-only",
      }),
      makeRecord({
        id: "cat-synced",
        title: "Catalog Synced Doc",
        localPresent: true,
        cloudPresent: true,
        cloudAccountId: "account-1",
        syncStatus: "synced",
      }),
    ]
    // Enrichment for one record + a writing that is NOT in the catalog.
    storage.writings = [
      makeWriting({ id: "cat-local", title: "Catalog Local Doc", body_text: "body" }),
      makeWriting({ id: "orphan-local", title: "Local Only Straggler", canonical_path: "/x.md" }),
    ]

    const { default: DeskPage } = await import("@/app/(app)/desk/page")

    await act(async () => {
      root = createRoot(container)
      root.render(<DeskPage />)
    })
    await flush()

    const text = container.textContent ?? ""
    expect(text).toContain("Catalog Local Doc")
    expect(text).toContain("Catalog Synced Doc")
    // Membership is the catalog: a writing only in IndexedDB is not rendered.
    expect(text).not.toContain("Local Only Straggler")
    // State is catalog-derived: the synced record carries the Synced badge.
    expect(container.querySelector('[aria-label="Artifact state: Synced"]')).not.toBeNull()
  })

  it("updates when a catalog change burst discovers a new document", async () => {
    catalog.state.records = [makeRecord({ id: "cat-1", title: "First Doc" })]
    storage.writings = [makeWriting({ id: "cat-1", title: "First Doc" })]

    const { default: DeskPage } = await import("@/app/(app)/desk/page")
    await act(async () => {
      root = createRoot(container)
      root.render(<DeskPage />)
    })
    await flush()
    expect(container.textContent).toContain("First Doc")
    expect(container.textContent).not.toContain("Watcher Discovered Doc")

    // A watcher-discovered file lands in the catalog and emits a change burst.
    catalog.state.records = [
      ...(catalog.state.records as DocumentCatalogRecord[]),
      makeRecord({ id: "cat-2", title: "Watcher Discovered Doc" }),
    ]
    await act(async () => {
      catalog.emit()
    })
    await waitPastDebounce()

    expect(container.textContent).toContain("Watcher Discovered Doc")
  })

  it("does not synthesize a Desk row for a confirmed soft-delete", async () => {
    catalog.state.records = [
      makeRecord({ id: "active", title: "Active Doc" }),
      makeRecord({
        id: "deleted",
        title: "Deleted Doc",
        localPresent: false,
        cloudPresent: true,
        syncStatus: "failed",
        deletedAt: "2026-07-18T00:00:00.000Z",
      }),
    ]

    const { default: DeskPage } = await import("@/app/(app)/desk/page")
    await act(async () => {
      root = createRoot(container)
      root.render(<DeskPage />)
    })
    await flush()

    expect(container.textContent).toContain("Active Doc")
    expect(container.textContent).not.toContain("Deleted Doc")
  })

  it("coalesces a burst of catalog changes into a single reload (reactive fan-out)", async () => {
    catalog.state.records = [makeRecord({ id: "cat-1", title: "Doc One" })]
    storage.writings = [makeWriting({ id: "cat-1", title: "Doc One" })]

    const { default: DeskPage } = await import("@/app/(app)/desk/page")
    await act(async () => {
      root = createRoot(container)
      root.render(<DeskPage />)
    })
    await flush()

    // Isolate the fan-out: ignore the initial bootstrap loads.
    catalog.instance.list.mockClear()

    // One bulk reconciliation can emit several change notifications in a burst.
    await act(async () => {
      catalog.emit()
      catalog.emit()
      catalog.emit()
    })
    await waitPastDebounce()

    // The Performance Contract requires one bulk change → one view refresh. The
    // coalescing debounce collapses the burst into a single catalog reload.
    expect(catalog.instance.list).toHaveBeenCalledTimes(1)
  })

  it("reloads Desk when desktop collection membership changes", async () => {
    // The product debounce is the signal under measurement, so it runs on the
    // controlled clock: the bootstrap `cloud-snapshot` debounce expires
    // deterministically before the counters reset instead of racing them
    // (ODE-623 P1). The barrier still polls with the real clock (`waitForDesk`),
    // so no fixed sleep is added.
    vi.useFakeTimers()
    try {
      catalog.state.records = [makeRecord({ id: "cat-1", title: "Collection Doc" })]
      // Hydration merges a remote row into the catalog and publishes the real
      // `cloud-snapshot` CatalogChange, so the reload that follows the
      // background hydration pass is observable on screen (ODE-623 barrier).
      sync.hydratedRecord = makeRecord({ id: "hydrated-1", title: "Hydrated Doc" })
      collectionStore.state.collections = [{
        id: "collection-1",
        owner_id: null,
        name: "Letters",
        description: null,
        visibility: "private",
        sync_status: "synced",
        lifecycle: "local-only",
        created_at: "2026-07-18T00:00:00.000Z",
        updated_at: "2026-07-18T00:00:00.000Z",
        local_updated_at: 1,
      }]

      // The background hydration pass stays held until the mount-local view and
      // the group control have settled, mirroring the production ordering (the
      // network pass lands after the mount-local work). This keeps the
      // `cloud-snapshot` notification on a live subscription instead of racing
      // the effect churn a warm module graph produces.
      let releaseHydration!: () => void
      sync.hydrationGate = new Promise((resolve) => {
        releaseHydration = resolve
      })

      const { default: DeskPage } = await import("@/app/(app)/desk/page")
      const { setLocalWritingCollections } = await import("@/lib/queries/desk-catalog-source")
      await act(async () => {
        root = createRoot(container)
        root.render(<DeskPage />)
      })
      await flush()

      // Group by collection so the applied assignment is observable in Desk's DOM
      // as the row's group label (the artifact row itself renders no chips).
      {
        const groupTrigger = container.querySelector<HTMLButtonElement>('[data-testid="desk-group-trigger"]')
        await act(async () => {
          groupTrigger?.click()
        })
        const collectionOption = Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Collection",
        )
        await act(async () => {
          collectionOption?.click()
        })
      }
      // Local row rendered and the group control re-rendered: release hydration.
      await waitForDesk(
        () => (container.textContent ?? "").includes("Collection Doc"),
        "fila local Collection Doc",
      )
      await act(async () => {
        releaseHydration()
      })

      // Bootstrap barrier (ODE-623): reset the counters only after the mount load
      // and EVERY hydration reload have settled. `Hydrated Doc` proves the
      // `cloud-snapshot` change was published and the post-hydration reload read
      // the catalog; then the debounced reload of that same change is expired on
      // the controlled clock, so no bootstrap notification can outlive the reset
      // and be misattributed to the membership event.
      await waitForDesk(
        () => (container.textContent ?? "").includes("Hydrated Doc"),
        "fila hidratada Hydrated Doc",
      )
      // Drain the `.then` tail (recipient-preview ids) so every bootstrap read
      // has been invoked before the debounced one is measured.
      await flush()
      await waitForDesk(() => catalog.state.pendingLists === 0, "lecturas del catálogo en vuelo")

      const bootstrapListCalls = catalog.instance.list.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150)
      })
      await waitForDesk(
        () => catalog.instance.list.mock.calls.length > bootstrapListCalls,
        "reload post-hidratación",
      )
      await waitForDesk(() => catalog.state.pendingLists === 0, "bootstrap asentado")

      // Positive control of attribution: no group label before the event, so the
      // one that appears below can only come from the membership refresh.
      expect(container.textContent ?? "").not.toContain("Letters")

      catalog.instance.list.mockClear()
      collectionStore.load.mockClear()

      await act(async () => {
        await setLocalWritingCollections("cat-1", ["collection-1"])
      })
      // The membership event schedules the same debounce; only its reload can
      // produce the group label now that the bootstrap notification settled.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150)
      })
      await waitForDesk(() => (container.textContent ?? "").includes("Letters"), "grupo Letters")

      expect(catalog.instance.list).toHaveBeenCalledTimes(1)
      expect(collectionStore.load).toHaveBeenCalledTimes(1)
      expect(collectionStore.state.writingCollections).toEqual([
        expect.objectContaining({ writing_id: "cat-1", collection_id: "collection-1" }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("renders the local catalog without waiting on cloud hydration (local-first / TTI)", async () => {
    sync.blockHydration = true
    catalog.state.records = [makeRecord({ id: "cat-1", title: "Local First Doc" })]
    storage.writings = [makeWriting({ id: "cat-1", title: "Local First Doc" })]

    const { default: DeskPage } = await import("@/app/(app)/desk/page")
    await act(async () => {
      root = createRoot(container)
      root.render(<DeskPage />)
    })
    await flush()

    // Cloud hydration is still pending, yet the local catalog row is on screen.
    expect(container.textContent).toContain("Local First Doc")
  })
})

describe("Workspace consumes the DocumentCatalog", () => {
  it("renders the same UUID with the same catalog state Desk shows", async () => {
    const sharedRecord = makeRecord({
      id: "shared-doc",
      title: "Shared Doc",
      localPresent: true,
      cloudPresent: true,
      cloudAccountId: "account-1",
      syncStatus: "synced",
      excerpt: "The same cached excerpt in both catalog views.",
      binding: {
        documentId: "shared-doc",
        bindingRootId: "root",
        relativePath: "Shared.md",
        canonicalPath: "/root/Shared.md",
        inode: null,
        contentHash: null,
        size: null,
        lastSeenAt: null,
      },
    })
    catalog.state.records = [sharedRecord]
    storage.writings = []

    workspaceDetail.current = {
      slug: "letters",
      name: "Letters",
      rootPath: "/root",
      selectedPaths: ["Shared.md"],
      source: "existing-folder",
      status: "ready",
      missingReason: null,
      addedAt: "2026-06-18T00:00:00.000Z",
      lastOpenedAt: null,
      fileCount: 1,
      folderCount: 0,
      updatedAt: 2000,
      files: [
        {
          id: "shared-doc",
          path: "/root/Shared.md",
          relativePath: "Shared.md",
          name: "Shared.md",
          modifiedAt: 2000,
          size: 10,
          inode: 1,
        },
      ],
    }

    const { WorkspaceDetailPrototype } = await import(
      "@/components/workspace/workspace-prototype-shell"
    )

    await act(async () => {
      root = createRoot(container)
      root.render(<WorkspaceDetailPrototype workspaceSlug="letters" />)
    })
    await flush()

    const text = container.textContent ?? ""
    expect(text).toContain("Shared")
    expect(text).toContain("The same cached excerpt in both catalog views.")
    expect(text).toContain("file:///root/Shared.md")
    // Same UUID, same catalog-derived state Desk renders (Synced), sourced from the
    // catalog join — not a direct IndexedDB read.
    expect(container.querySelector('[aria-label="Artifact state: Synced"]')).not.toBeNull()
  })

  it("reflects a Workspace status mutation in Desk through the shared catalog", async () => {
    const sharedRecord = makeRecord({
      id: "shared-doc",
      title: "Shared Doc",
      status: "draft",
      artifactType: "general",
      localPresent: true,
      cloudPresent: false,
      syncStatus: "local-only",
      excerpt: "The same cached excerpt in both catalog views.",
      binding: {
        documentId: "shared-doc",
        bindingRootId: "root",
        relativePath: "Shared.md",
        canonicalPath: "/root/Shared.md",
        inode: null,
        contentHash: null,
        size: null,
        lastSeenAt: null,
      },
    })
    catalog.state.records = [sharedRecord]
    storage.writings = []

    workspaceDetail.current = {
      slug: "letters",
      name: "Letters",
      rootPath: "/root",
      selectedPaths: ["Shared.md"],
      source: "existing-folder",
      status: "ready",
      missingReason: null,
      addedAt: "2026-06-18T00:00:00.000Z",
      lastOpenedAt: null,
      fileCount: 1,
      folderCount: 0,
      updatedAt: 2000,
      files: [
        {
          id: "shared-doc",
          path: "/root/Shared.md",
          relativePath: "Shared.md",
          name: "Shared.md",
          modifiedAt: 2000,
          size: 10,
          inode: 1,
        },
      ],
    }

    const deskContainer = document.createElement("div")
    document.body.appendChild(deskContainer)
    const workspaceContainer = document.createElement("div")
    document.body.appendChild(workspaceContainer)

    try {
      const { default: DeskPage } = await import("@/app/(app)/desk/page")
      await act(async () => {
        root = createRoot(deskContainer)
        root.render(<DeskPage />)
      })
      await flush()

      const { WorkspaceDetailPrototype } = await import(
        "@/components/workspace/workspace-prototype-shell"
      )
      const workspaceMountStartedAt = performance.now()
      await act(async () => {
        root = createRoot(workspaceContainer)
        root.render(<WorkspaceDetailPrototype workspaceSlug="letters" />)
      })
      await flush()
      const workspaceTimeToUsefulPaintMs = performance.now() - workspaceMountStartedAt
      expect(workspaceTimeToUsefulPaintMs).toBeLessThan(1_500)

      expect(deskContainer.textContent).toContain("Draft")
      expect(workspaceContainer.textContent).toContain("Draft")
      expect(deskContainer.textContent).not.toContain("In Review")
      expect(workspaceContainer.textContent).not.toContain("In Review")
      const collectionButton = workspaceContainer.querySelector<HTMLButtonElement>(
        'button[aria-label="Assign collections for Shared"]',
      )
      expect(collectionButton).not.toBeNull()
      expect(collectionButton?.disabled).toBe(false)

      let releaseRefresh!: () => void
      catalog.state.blockNextList = new Promise<void>((resolve) => {
        releaseRefresh = resolve
      })

      await act(async () => {
        await changeWritingStatus("shared-doc", "in_review")
      })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120))
      })
      expect(workspaceContainer.textContent).toContain("Shared")
      expect(workspaceContainer.textContent).not.toContain("Loading workspace")

      releaseRefresh()
      await waitPastDebounce()

      expect(deskContainer.textContent).toContain("In Review")
      expect(workspaceContainer.textContent).toContain("In Review")
    } finally {
      deskContainer.remove()
      workspaceContainer.remove()
    }
  })
})
