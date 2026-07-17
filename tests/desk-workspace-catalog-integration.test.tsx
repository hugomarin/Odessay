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

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ----------------------------- shared fakes ------------------------------ */

const catalog = vi.hoisted(() => {
  const listeners = new Set<(change: unknown) => void>()
  const state: { records: unknown[] } = { records: [] }
  return {
    state,
    listeners,
    emit() {
      listeners.forEach((listener) =>
        listener({ transactionId: "t", documentIds: [], reason: "bulk", occurredAt: Date.now() }),
      )
    },
    instance: {
      list: vi.fn(async () => state.records),
      getById: async (id: string) =>
        (state.records as DocumentCatalogRecord[]).find((r) => r.id === id) ?? null,
      resolvePath: async (path: string) => ({ kind: "unbound", path }),
      registerBinding: vi.fn(),
      detachLocalFile: vi.fn(),
      applyCloudSnapshot: vi.fn(),
      subscribe: (listener: (change: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
})

const storage = vi.hoisted(() => ({ writings: [] as LocalWriting[] }))

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
  getLocalDBScope: () => "anonymous",
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
  loadDesktopCollections: async () => ({ collections: [], writingCollections: [] }),
  createDesktopCollection: vi.fn(),
  deleteDesktopCollection: vi.fn(),
  setDesktopWritingCollections: vi.fn(),
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
const sync = vi.hoisted(() => ({ blockHydration: false }))
vi.mock("@/lib/sync", () => ({
  getSyncService: () => ({
    // When blocked, cloud hydration never resolves — Desk must still render its
    // local catalog rows (local-first / TTI not gated on the network).
    hydrateWritings: () =>
      sync.blockHydration ? new Promise(() => {}) : Promise.resolve({ data: null }),
    hydrateCollections: () =>
      sync.blockHydration ? new Promise(() => {}) : Promise.resolve({ data: null }),
    scheduleFlush: () => {},
  }),
}))
vi.mock("@/lib/sync/queue", () => ({
  enqueueWritingUpsert: vi.fn(),
  enqueueWritingDelete: vi.fn(),
}))
vi.mock("@/lib/sync/remote-bootstrap", () => ({ invalidateWebWritingsHydrationFreshness: vi.fn() }))
vi.mock("@/lib/collections/remote-bootstrap", () => ({ invalidateWebCollectionsHydrationFreshness: vi.fn() }))
vi.mock("@/lib/services/auth-service-factory", () => ({
  getAuthService: () => ({ getSession: async () => ({ data: { user: null } }) }),
}))
vi.mock("@/lib/services/document-service-factory", () => ({
  getDocumentService: async () => ({ exportWriting: async () => ({ data: null, error: null }) }),
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
  createdAt: partial.createdAt ?? 1000,
  modifiedAt: partial.modifiedAt ?? 2000,
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

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  catalog.state.records = []
  catalog.listeners.clear()
  storage.writings = []
  sync.blockHydration = false
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
    expect(container.querySelector('[aria-label="Document state: Synced"]')).not.toBeNull()
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
      syncStatus: "synced",
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
    expect(text).toContain("Shared.md")
    // Same UUID, same catalog-derived state Desk renders (Synced), sourced from the
    // catalog join — not a direct IndexedDB read.
    expect(container.querySelector('[aria-label="Document state: Synced"]')).not.toBeNull()
  })
})
