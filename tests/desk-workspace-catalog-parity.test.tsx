/**
 * @contract ODE-373 — Desk/Workspace DocumentCatalog view parity
 * @doc workflow/context/features/odessay-desktop-document-catalog.md §Desk y Workspace como vistas del catálogo
 * @service DocumentCatalog.list + shared view-model (lib/queries/document-catalog.ts)
 *
 * Proves the DoD's central claim: Desk and Workspace are two views of the SAME
 * DocumentCatalog. Given one base record set, the two grouping functions must
 * preserve identical UUID → state maps and identical cached metadata; only the
 * grouping/placement differs. Pure view-model — no rendering, no storage.
 */
import { describe, expect, it, vi } from "vitest"

// The parity/view-model functions are pure; stub the runtime catalog factory so
// importing the module never pulls in the SQLite/IndexedDB adapters.
vi.mock("@/lib/services/document-catalog-factory", () => ({
  getDocumentCatalog: vi.fn(),
}))

import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import {
  buildCatalogRows,
  catalogStateById,
  groupCatalogForDesk,
  groupCatalogForWorkspace,
  toCatalogRowViewModel,
  CATALOG_CLOUD_GROUP_KEY,
} from "@/lib/queries/document-catalog"

const makeRecord = (partial: Partial<DocumentCatalogRecord> = {}): DocumentCatalogRecord => ({
  id: partial.id ?? "doc-1",
  localPresent: partial.localPresent ?? true,
  cloudPresent: partial.cloudPresent ?? false,
  cloudAccountId: partial.cloudAccountId ?? null,
  syncStatus: partial.syncStatus ?? "local-only",
  title: "title" in partial ? (partial.title ?? null) : "Doc",
  slug: partial.slug ?? null,
  status: partial.status ?? "draft",
  artifactType: partial.artifactType ?? "general",
  visibility: partial.visibility ?? "private",
  version: partial.version ?? 1,
  createdAt: partial.createdAt ?? 1_000,
  modifiedAt: partial.modifiedAt ?? 2_000,
  binding:
    partial.binding === undefined
      ? {
          documentId: partial.id ?? "doc-1",
          bindingRootId: "root-a",
          relativePath: "Doc.md",
          canonicalPath: "/root-a/Doc.md",
          inode: null,
          contentHash: null,
          size: null,
          lastSeenAt: null,
        }
      : partial.binding,
})

const baseSet = (): DocumentCatalogRecord[] => [
  makeRecord({ id: "local", localPresent: true, cloudPresent: false, syncStatus: "local-only" }),
  makeRecord({
    id: "synced",
    localPresent: true,
    cloudPresent: true,
    syncStatus: "synced",
    binding: {
      documentId: "synced",
      bindingRootId: "root-b",
      relativePath: "Synced.md",
      canonicalPath: "/root-b/Synced.md",
      inode: null,
      contentHash: null,
      size: null,
      lastSeenAt: null,
    },
  }),
  makeRecord({ id: "conflict", localPresent: true, cloudPresent: true, syncStatus: "conflict" }),
  makeRecord({
    id: "cloud",
    localPresent: false,
    cloudPresent: true,
    syncStatus: "synced",
    cloudAccountId: "acc-1",
    binding: null,
  }),
]

describe("catalog view-model state derivation", () => {
  it("derives every legitimate state from presence + sync signals", () => {
    expect(toCatalogRowViewModel(makeRecord({ localPresent: true, cloudPresent: false })).state).toBe("local-only")
    expect(
      toCatalogRowViewModel(makeRecord({ localPresent: true, cloudPresent: true, syncStatus: "synced" })).state,
    ).toBe("synced")
    expect(
      toCatalogRowViewModel(makeRecord({ localPresent: false, cloudPresent: true, binding: null })).state,
    ).toBe("cloud-only")
    expect(toCatalogRowViewModel(makeRecord({ syncStatus: "pending" })).state).toBe("pending")
    expect(toCatalogRowViewModel(makeRecord({ syncStatus: "failed" })).state).toBe("sync-failed")
    expect(toCatalogRowViewModel(makeRecord({ syncStatus: "conflict" })).state).toBe("conflict")
  })

  it("lets operational overlays dominate presence/sync states", () => {
    const record = makeRecord({ localPresent: true, cloudPresent: true, syncStatus: "synced" })
    expect(toCatalogRowViewModel(record, { rebuilding: true }).state).toBe("rebuilding")
    expect(toCatalogRowViewModel(record, { ambiguous: true }).state).toBe("ambiguous")
    expect(toCatalogRowViewModel(record, { stale: true }).state).toBe("stale")
    // conflict (a real document state) still wins over a list-wide stale overlay.
    expect(
      toCatalogRowViewModel(makeRecord({ syncStatus: "conflict" }), { stale: true }).state,
    ).toBe("conflict")
  })

  it("falls back to Untitled writing for blank titles", () => {
    expect(toCatalogRowViewModel(makeRecord({ title: "   " })).title).toBe("Untitled writing")
    expect(toCatalogRowViewModel(makeRecord({ title: null })).title).toBe("Untitled writing")
  })
})

describe("Desk and Workspace parity", () => {
  it("resolves the same UUID → state map in both views", () => {
    const rows = buildCatalogRows(baseSet())

    const deskRows = groupCatalogForDesk(rows, { groupBy: "state" }).flatMap((group) => group.rows)
    const workspaceRows = groupCatalogForWorkspace(rows, { includeCloudOnly: true }).flatMap(
      (group) => group.rows,
    )

    const deskState = catalogStateById(deskRows)
    const workspaceState = catalogStateById(workspaceRows)

    // Identical id set and identical state per id — the parity invariant.
    expect(new Set(deskState.keys())).toEqual(new Set(workspaceState.keys()))
    for (const [id, state] of deskState) {
      expect(workspaceState.get(id)).toBe(state)
    }
  })

  it("shares cached metadata (title/slug/path) across both views", () => {
    const rows = buildCatalogRows(baseSet())
    const deskById = new Map(
      groupCatalogForDesk(rows).flatMap((group) => group.rows).map((row) => [row.id, row]),
    )
    const wsById = new Map(
      groupCatalogForWorkspace(rows, { includeCloudOnly: true })
        .flatMap((group) => group.rows)
        .map((row) => [row.id, row]),
    )

    for (const [id, deskRow] of deskById) {
      const wsRow = wsById.get(id)
      expect(wsRow).toBeDefined()
      expect(wsRow!.title).toBe(deskRow.title)
      expect(wsRow!.localPath).toBe(deskRow.localPath)
      expect(wsRow!.bindingRootId).toBe(deskRow.bindingRootId)
    }
  })

  it("keeps a binding orphan from becoming an editable empty writing", () => {
    // A record with no binding and no cloud record must not surface as a normal
    // local row a user could edit as an empty writing.
    const orphan = makeRecord({ id: "orphan", localPresent: false, cloudPresent: false, binding: null })
    const rows = buildCatalogRows([orphan])
    const workspaceGroups = groupCatalogForWorkspace(rows, { includeCloudOnly: true })
    // Not bound to any root and not cloud-present → not shown in any Workspace group.
    expect(workspaceGroups.flatMap((group) => group.rows)).toHaveLength(0)
  })
})

describe("Desk grouping", () => {
  it("lists all accessible records regardless of BindingRoot", () => {
    const rows = buildCatalogRows(baseSet())
    const deskIds = groupCatalogForDesk(rows).flatMap((group) => group.rows).map((row) => row.id)
    expect(new Set(deskIds)).toEqual(new Set(["local", "synced", "conflict", "cloud"]))
  })

  it("orders state groups with recovery states first", () => {
    const rows = buildCatalogRows(baseSet())
    const labels = groupCatalogForDesk(rows, { groupBy: "state" }).map((group) => group.key)
    expect(labels.indexOf("conflict")).toBeLessThan(labels.indexOf("synced"))
  })
})

describe("Workspace grouping", () => {
  it("groups by BindingRoot and filters to visible roots", () => {
    const rows = buildCatalogRows(baseSet())
    const groups = groupCatalogForWorkspace(rows, { visibleBindingRootIds: ["root-a"] })
    expect(groups.map((group) => group.key)).toEqual(["root-a"])
    expect(groups[0].rows.every((row) => row.bindingRootId === "root-a")).toBe(true)
  })

  it("buckets cloud-only records separately when requested", () => {
    const rows = buildCatalogRows(baseSet())
    const groups = groupCatalogForWorkspace(rows, { includeCloudOnly: true })
    const cloudGroup = groups.find((group) => group.key === CATALOG_CLOUD_GROUP_KEY)
    expect(cloudGroup?.rows.map((row) => row.id)).toEqual(["cloud"])
  })

  it("applies human labels to roots", () => {
    const rows = buildCatalogRows(baseSet())
    const groups = groupCatalogForWorkspace(rows, {
      rootLabels: new Map([["root-a", "Essays"], ["root-b", "Letters"]]),
    })
    expect(groups.map((group) => group.label).sort()).toEqual(["Essays", "Letters"])
  })
})
