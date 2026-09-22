/** @vitest-environment happy-dom */
/**
 * WS-02 / DOC-08 / SYS-04 — moving a document between two real,
 * independently-registered Workspace roots converges to a single consistent
 * state. (WATCH-04 shares the same *conceptual* gap but is a genuinely
 * different code path — an externally-triggered move reconciled by the
 * watcher, which never calls `relocateDesktopWriting` — and is intentionally
 * NOT closed here; see its own row in the capability map.)
 *
 * Real entry point: `DesktopWorkspaceService.assignToWorkspace` (the real
 * "Assign to Workspace" UI action in Desk) -> real `relocateDesktopWriting`
 * -> real (unmocked) `SqliteDocumentCatalog` -> real `DesktopSettingsService`
 * -> two distinct real temp directories standing in for two distinct
 * registered Workspaces. Only the native Tauri IPC transport is faked, via
 * the same real-fs/real-in-memory-catalog doubles DOC-02/03/06 and WATCH-07
 * already use, plus a per-root manifest map (see `tauriWorkspaceSyncDouble`
 * in the shared support module) that proves real Workspace-manifest
 * convergence, not just filesystem/catalog convergence.
 *
 * Prior state: `tests/services/document-service-factory.test.ts` (ODE-402)
 * and `tests/services/workspace-service.test.ts` (ODE-403) mock every
 * collaborator — the real cross-root convergence logic never executed in
 * either. This is the first test to actually move a real file between two
 * real, distinct BindingRoots.
 *
 * See workflow/quality/capability-integration-map.md (WS-02, DOC-08, SYS-04).
 */
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  configureRealDesktopDoubles,
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriCatalogDetachLocalFileDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogListRetiredBindingRootsDouble,
  tauriCatalogResolvePathDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriPathModuleDouble,
  tauriRelocateFileDouble,
  tauriSettingsDeleteDouble,
  tauriSettingsReadDouble,
  tauriSettingsWriteDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "./support/real-desktop-doubles"

// Every function real production code imports from these two modules must be
// present, even ones unused by this scenario — stubbed to throw loudly
// rather than silently misbehave if a code path this test doesn't expect
// ever calls them (same convention as materialize-save-reopen.test.ts).
function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for the cross-workspace-move proof and was not expected to be called`)
  })
}

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: unimplemented("open (native folder picker)"),
}))

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCreateFile: tauriCreateFileDouble,
  tauriWriteFile: tauriWriteFileDouble,
  tauriOpenFile: tauriOpenFileDouble,
  tauriListRecentFiles: tauriListRecentFilesDouble,
  tauriRenameFile: unimplemented("tauriRenameFile"),
  tauriRelocateFile: tauriRelocateFileDouble,
  tauriWorkspaceCreate: unimplemented("tauriWorkspaceCreate"),
  tauriWorkspaceInspect: unimplemented("tauriWorkspaceInspect"),
  tauriWorkspaceRepairManifestBindings: unimplemented("tauriWorkspaceRepairManifestBindings"),
  tauriWorkspaceSync: tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFile: tauriWorkspaceTouchFileDouble,
  tauriCatalogDualWrite: tauriCatalogDualWriteDouble,
  tauriCatalogBulkDualWrite: unimplemented("tauriCatalogBulkDualWrite"),
  tauriCatalogGetById: tauriCatalogGetByIdDouble,
  tauriCatalogResolvePath: tauriCatalogResolvePathDouble,
  tauriCatalogList: tauriCatalogListDouble,
  tauriCatalogDetachLocalFile: tauriCatalogDetachLocalFileDouble,
  tauriCatalogHydrateExcerpts: vi.fn(async () => []),
  tauriCatalogApplyReconcile: unimplemented("tauriCatalogApplyReconcile"),
  tauriCatalogApplyCloudSnapshots: unimplemented("tauriCatalogApplyCloudSnapshots"),
  tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
  tauriCatalogActivateBindingRoot: vi.fn(async () => undefined),
  tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
  tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
  tauriCatalogListRetiredBindingRoots: tauriCatalogListRetiredBindingRootsDouble,
  tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
  tauriSettingsRead: tauriSettingsReadDouble,
  tauriSettingsWrite: tauriSettingsWriteDouble,
  tauriSettingsDelete: tauriSettingsDeleteDouble,
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

// Cloud sync flush is the one deliberately-allowed fake (external network
// boundary, not part of this property's declared chain) — same convention
// as every other real-desktop-doubles proof in this repo.
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
const { DesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")
const { DesktopSettingsService } = await import("@/lib/services/desktop/desktop-settings-service")

const bodyJson = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

let baseDir: string
let configDir: string

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "odessay-cross-workspace-"))
  configureRealDesktopDoubles(baseDir)
  configDir = join(baseDir, "config")
})

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetCatalogDoubles()
  resetSettingsStoreDouble()
})

async function registerTwoWorkspaces() {
  const rootA = mkdtempSync(join(baseDir, "workspace-a-"))
  const rootB = mkdtempSync(join(baseDir, "workspace-b-"))
  const settings = new DesktopSettingsService(configDir)
  const nowIso = new Date().toISOString()

  // A real Workspace is always both a WorkspaceRecord (UI-facing) and a
  // registered BindingRoot (catalog-facing) at once — that's what
  // `registerWorkspace` itself does in production. Registering only the
  // WorkspaceRecord half would leave `relocateDesktopWriting`'s destRootPath
  // resolution (document-service-factory.ts:738-753) always taking the
  // "no settingsRecord" branch, never exercising the real risk the
  // investigation flagged: comparing two independently-sourced root lists.
  await settings.upsertBindingRoot({
    id: `binding-root-a-${randomUUID()}`, rootPath: rootA, kind: "external",
    visibleAsWorkspace: true, selectedPaths: [], consentedAt: nowIso, createdAt: nowIso,
  })
  await settings.upsertBindingRoot({
    id: `binding-root-b-${randomUUID()}`, rootPath: rootB, kind: "external",
    visibleAsWorkspace: true, selectedPaths: [], consentedAt: nowIso, createdAt: nowIso,
  })
  await settings.updateDesktopSettings({
    workspaces: [
      { slug: "workspace-a", name: "Workspace A", rootPath: rootA, source: "scratch", addedAt: nowIso, lastOpenedAt: null },
      { slug: "workspace-b", name: "Workspace B", rootPath: rootB, source: "scratch", addedAt: nowIso, lastOpenedAt: null },
    ],
  })

  return { rootA, rootB, workspaceService: new DesktopWorkspaceService(settings) }
}

async function catalogRow(id: string) {
  const dbPath = join(configDir, "desktop-index.sqlite3")
  return tauriCatalogGetByIdDouble(dbPath, id)
}

describe("WS-02/DOC-08/SYS-04 — move a document between two real Workspace roots", () => {
  it("converges to a single consistent binding after A -> B, leaving nothing behind in A", async () => {
    const { rootA, rootB, workspaceService } = await registerTwoWorkspaces()

    const draft = await createDesktopDraft({
      title: "Cross-workspace document",
      initialBodyJson: bodyJson("Content that must survive two real cross-Workspace moves."),
      initialBodyText: "Content that must survive two real cross-Workspace moves.",
    })
    expect(draft.error).toBeNull()
    const id = draft.data!.id

    // First move: managed root -> Workspace A (a real, reachable case on
    // its own, and the starting point for the actually-uncovered hop below).
    await workspaceService.assignToWorkspace(id, "workspace-a")

    const rowInA = await catalogRow(id)
    expect(rowInA?.canonicalPath?.startsWith(rootA)).toBe(true)
    const contentInA = await readFile(rowInA!.canonicalPath!, "utf8")
    expect(contentInA).toContain("Content that must survive two real cross-Workspace moves.")

    // Second move: Workspace A -> Workspace B — the specific "two distinct
    // real registered roots" gap the map identifies. Neither root is the
    // managed default; both are independently registered Workspaces.
    await workspaceService.assignToWorkspace(id, "workspace-b")

    const rowInB = await catalogRow(id)
    expect(rowInB).not.toBeNull()
    expect(rowInB!.canonicalPath!.startsWith(rootB)).toBe(true)
    expect(rowInB!.bindingRootId).not.toBe(rowInA!.bindingRootId)

    // Exactly one catalog row for this id (no duplicate/orphaned identity).
    const dbPath = join(configDir, "desktop-index.sqlite3")
    const allRows = await tauriCatalogListDouble(dbPath)
    expect(allRows.filter((row) => row.id === id)).toHaveLength(1)

    // Real disk: the file exists only under B, with its content intact —
    // moved, not copied-and-orphaned. Checking the whole directory listing
    // (not just the one expected old path) rules out a stray leftover copy
    // anywhere else in A, e.g. from a buggy copy-based fallback.
    const contentInB = await readFile(rowInB!.canonicalPath!, "utf8")
    expect(contentInB).toContain("Content that must survive two real cross-Workspace moves.")
    await expect(readFile(rowInA!.canonicalPath!, "utf8")).rejects.toThrow()
    const rootAEntries = await readdir(rootA)
    expect(rootAEntries).toHaveLength(0)

    // Workspace-manifest convergence, not just filesystem/catalog: calling
    // tauriWorkspaceSync with no explicit ids — production's own "rescan/
    // reconcile this root" form, exercised for real here (see the double's
    // fix) — proves A's manifest no longer claims this document, and B's
    // manifest claims it at the same path the catalog already agreed on.
    const rescanA = await tauriWorkspaceSyncDouble(rootA, undefined, undefined)
    expect(rescanA.files.some((file) => file.id === id)).toBe(false)
    const rescanB = await tauriWorkspaceSyncDouble(rootB, undefined, undefined)
    const fileInB = rescanB.files.find((file) => file.id === id)
    expect(fileInB).toBeDefined()
    expect(fileInB!.path).toBe(rowInB!.canonicalPath)
  })

  it("round-trips B -> A without orphaning or duplicating the document", async () => {
    const { rootA, rootB, workspaceService } = await registerTwoWorkspaces()

    const draft = await createDesktopDraft({
      title: "Round-trip document",
      initialBodyJson: bodyJson("Round-trip content."),
      initialBodyText: "Round-trip content.",
    })
    const id = draft.data!.id

    await workspaceService.assignToWorkspace(id, "workspace-a")
    await workspaceService.assignToWorkspace(id, "workspace-b")
    await workspaceService.assignToWorkspace(id, "workspace-a")

    const finalRow = await catalogRow(id)
    expect(finalRow!.canonicalPath!.startsWith(rootA)).toBe(true)

    const dbPath = join(configDir, "desktop-index.sqlite3")
    const allRows = await tauriCatalogListDouble(dbPath)
    expect(allRows.filter((row) => row.id === id)).toHaveLength(1)

    const rootBEntries = await readdir(rootB)
    expect(rootBEntries).toHaveLength(0)

    const rescanB = await tauriWorkspaceSyncDouble(rootB, undefined, undefined)
    expect(rescanB.files.some((file) => file.id === id)).toBe(false)
    const rescanA = await tauriWorkspaceSyncDouble(rootA, undefined, undefined)
    const fileInA = rescanA.files.find((file) => file.id === id)
    expect(fileInA).toBeDefined()
    expect(fileInA!.path).toBe(finalRow!.canonicalPath)

    const content = await readFile(finalRow!.canonicalPath!, "utf8")
    expect(content).toContain("Round-trip content.")
  })
})
