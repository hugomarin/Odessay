/** @vitest-environment happy-dom */
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  configureRealDesktopDoubles,
  failWriteFileOnCall,
  resetCatalogDoubles,
  resetWriteFileFailureState,
  tauriCatalogDetachLocalFileDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogResolvePathDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriPathModuleDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "./support/real-desktop-doubles"

// Every function this repo's production code imports from these two
// modules must be present, even the ones unused by the document-lifecycle
// path (DOC-02/03/06) below — those are stubbed to throw loudly rather than
// silently returning something wrong if a code path this suite doesn't
// expect ever calls them.
function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for DOC-02/03/06 and was not expected to be called`)
  })
}

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCreateFile: tauriCreateFileDouble,
  tauriWriteFile: tauriWriteFileDouble,
  tauriOpenFile: tauriOpenFileDouble,
  tauriListRecentFiles: tauriListRecentFilesDouble,
  tauriRenameFile: unimplemented("tauriRenameFile"),
  tauriRelocateFile: unimplemented("tauriRelocateFile"),
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
  tauriCatalogActivateBindingRoot: unimplemented("tauriCatalogActivateBindingRoot"),
  tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
  tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
  tauriCatalogListRetiredBindingRoots: unimplemented("tauriCatalogListRetiredBindingRoots"),
  tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

// Cloud sync flush is the one deliberately-allowed fake in every Proof
// Contract below (an external network boundary, not part of the declared
// chain's own property) — the real SyncWorker reads from real IndexedDB via
// localDB, which this suite has no reason to spin up.
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

// Imported after the mocks above so the factory module picks them up.
const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { createPersistenceCoordinator } = await import("@/lib/editor/persistence-coordinator")

const bodyJson = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

let workspaceRoot: string

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "odessay-doc-lifecycle-"))
  configureRealDesktopDoubles(workspaceRoot)
})

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

afterEach(() => {
  resetCatalogDoubles()
  resetWriteFileFailureState()
})

/**
 * DOC-02 — Materialize first content
 *
 * Property: the first real content entered into an ephemeral desktop
 * document produces exactly one durable document; UUID, binding, catalog
 * and file all agree.
 *
 * Real collaborators: DesktopDocumentService (real, via createDesktopDraft),
 * FilesystemDocumentService (real class), SqliteDocumentCatalog (real
 * class) — backed by real fs + a real in-memory catalog double, not spies.
 * Allowed fakes: the native Tauri transport itself (no bridge in Vitest —
 * replaced with equivalent real behavior, see support/real-desktop-doubles.ts)
 * and the cloud sync flush (external network boundary).
 *
 * Given: an empty temporary workspace.
 * When: createDesktopDraft({ title, initialBodyJson }) with real content.
 * Then:
 *   - the record's catalog id is a UUID, distinct from the file path (SYS-02);
 *   - exactly one .md file exists on real disk;
 *   - its real content matches what was serialized;
 *   - catalog.getById(id) and catalog.resolvePath(path) resolve to the same,
 *     single record.
 *
 * Failure: the filesystem write fails (e.g. disk full).
 * Then: no success is reported, and no catalog row exists for that id
 * afterward — a failed materialization must not leave orphan durable state.
 */
describe("DOC-02 — Materialize first content", () => {
  it("produces exactly one durable document, with UUID, file and catalog agreeing", async () => {
    const result = await createDesktopDraft({
      title: "My First Note",
      initialBodyJson: bodyJson("Hello, Odessay"),
      initialBodyText: "Hello, Odessay",
    })

    expect(result.error).toBeNull()
    const record = result.data!

    // UUID vs path (SYS-02): the catalog identity must not be the file path.
    expect(record.id).not.toContain(workspaceRoot)
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)

    const catalogRow = await getCatalogRecord(record.id)
    expect(catalogRow?.binding?.canonicalPath).toBeTruthy()
    const canonicalPath = catalogRow!.binding!.canonicalPath

    // Real file, real content, on real disk.
    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toContain("Hello, Odessay")

    // Exactly one file materialized in the workspace.
    const files = await listWorkspaceFiles()
    expect(files).toHaveLength(1)

    // getById and resolvePath must agree on the same identity.
    const resolvedByPath = await resolveByPath(canonicalPath)
    expect(resolvedByPath?.id).toBe(record.id)
  })

  it("FAILURE — a filesystem write failure reports no success and leaves no orphan catalog row", async () => {
    // FilesystemDocumentService.createDraft's own internal "# title\n\n"
    // placeholder write is real call #1 (DesktopDocumentService always
    // supplies a default title to it, so this fires even without one here).
    // persist()'s real-content save is call #2 — the one this test targets.
    // Verified live (see PR description): failing call #1 instead, or
    // skipping it via `preferredPath` (which also skips creating the file at
    // all, so a later fs.stat fails for an unrelated reason), both let this
    // test pass even with persist()'s own
    // `if (fileResult.error) throw ...` check deleted — i.e. they silently
    // protect nothing. Only targeting call #2 by number actually isolates it.
    failWriteFileOnCall(2, () => {
      throw new Error("ENOSPC: no space left on device (simulated)")
    })

    const result = await createDesktopDraft({
      title: "Should Not Persist",
      initialBodyJson: bodyJson("this must not become durable"),
    })

    expect(result.error).not.toBeNull()
    expect(result.data).toBeNull()

    // The id was minted in-memory before the failed write; confirm it never
    // reached the catalog as a durable row.
    const failedAttemptIds = await allCatalogIds()
    expect(failedAttemptIds).toHaveLength(0)
  })
})

/**
 * DOC-03 — Save document (+ RACE variant)
 *
 * Property: confirmed content is saved durably and recoverable; a stale
 * save that settles after a newer one must never overwrite it (DOC-04's
 * property, exercised here rather than as a separate scenario per the
 * capability map's "don't invent new capabilities for a variant" guidance).
 *
 * Real collaborators: PersistenceCoordinator (real), DesktopDocumentService
 * (real, via getDocumentService()), real fs, real catalog double.
 * Allowed fakes: same as DOC-02, plus a controlled delay wrapped around the
 * *first* saveWriting call only — the delay itself is test control, not a
 * fake of behavior; the real save still executes underneath it.
 */
describe("DOC-03 — Save document", () => {
  it("persists new content durably and it is recoverable from the real file", async () => {
    const draft = await createDesktopDraft({ title: "Save Target", initialBodyJson: bodyJson("v1") })
    const record = draft.data!
    const service = await getDocumentService()

    const saved = await service.saveWriting({
      writing: { ...record, content: { ...record.content, richText: bodyJson("v2"), plainText: "v2" } },
    })

    expect(saved.error).toBeNull()
    const catalogRow = await getCatalogRecord(record.id)
    const canonicalPath = catalogRow!.binding!.canonicalPath
    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toContain("v2")
    expect(onDisk).not.toContain("v1")
  })

  it("RACE — a stale save that settles after a newer one does not overwrite the newer content", async () => {
    const draft = await createDesktopDraft({ title: "Race Target", initialBodyJson: bodyJson("initial") })
    const record = draft.data!
    const service = await getDocumentService()

    let releaseFirstSave: (() => void) | null = null
    let saveCallCount = 0
    let resolveSecondCallSettled: (() => void) | null = null
    const secondCallSettled = new Promise<void>((resolve) => {
      resolveSecondCallSettled = resolve
    })
    const realSaveWriting = service.saveWriting.bind(service)
    const delayedSaveWriting: typeof service.saveWriting = async (input) => {
      saveCallCount += 1
      const myCall = saveCallCount
      if (myCall === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve
        })
      }
      const result = await realSaveWriting(input)
      // The coordinator's own persist() promise resolves once the request is
      // handed off, not once THIS specific save's real disk/catalog write has
      // actually landed — waiting on Promise.all([resultA, resultB]) alone
      // let the assertions below run while call #2's write was still in
      // flight (confirmed by adding this signal: without it, the test reads
      // stale "SAVE A" content). Wait on this instead of trusting persist()'s
      // timing for what "settled" means at the storage layer.
      if (myCall === 2) resolveSecondCallSettled?.()
      return result
    }

    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      persistenceDebounceMs: 0,
      documentService: { saveWriting: delayedSaveWriting },
      createWritingId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })

    const snapshotA = {
      writingId: record.id,
      createdAt: record.createdAt,
      version: record.version,
      title: record.title ?? "Untitled",
      bodyJson: bodyJson("SAVE A — should lose the race"),
      bodyText: "SAVE A — should lose the race",
      status: record.status,
      artifactType: record.artifactType,
      visibility: record.visibility,
      lifecycle: "local-only" as const,
    }
    const snapshotB = { ...snapshotA, bodyJson: bodyJson("SAVE B — should win the race"), bodyText: "SAVE B — should win the race" }

    const resultA = coordinator.persist(snapshotA)
    await vi.waitFor(() => expect(saveCallCount).toBe(1))

    const resultB = coordinator.persist(snapshotB)
    // B must not have started its own saveWriting call yet — the coordinator
    // collapses it into the single pending slot for this document.
    expect(saveCallCount).toBe(1)

    releaseFirstSave!()
    await Promise.all([resultA, resultB])
    await secondCallSettled

    const catalogRow = await getCatalogRecord(record.id)
    const canonicalPath = catalogRow!.binding!.canonicalPath
    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toContain("SAVE B")
    expect(onDisk).not.toContain("SAVE A")
  })
})

/**
 * DOC-06 — Close and reopen
 *
 * Property: reopened content equals the latest confirmed durable content.
 * Real collaborators: same as DOC-03. "Close" has no separate state to
 * simulate here (the desktop service is stateless between calls — no
 * in-memory session survives a reopen) so this exercises exactly what the
 * chain declares: save -> catalog/binding lookup -> filesystem read -> parse.
 */
describe("DOC-06 — Close and reopen", () => {
  it("reopening returns exactly the last saved content, via a fresh catalog + filesystem read", async () => {
    const draft = await createDesktopDraft({ title: "Reopen Target", initialBodyJson: bodyJson("first draft") })
    const record = draft.data!
    const service = await getDocumentService()

    await service.saveWriting({
      writing: { ...record, content: { ...record.content, richText: bodyJson("final content before close"), plainText: "final content before close" } },
    })

    const reopened = await service.openWriting(record.id)

    expect(reopened.error).toBeNull()
    expect(reopened.data!.content.plainText).toContain("final content before close")
  })
})

// ─── helpers ────────────────────────────────────────────────────────────────

async function getCatalogRecord(id: string) {
  const row = await tauriCatalogGetByIdDouble(await desktopDbPath(), id)
  if (!row) return null
  return {
    id: row.id,
    binding: row.canonicalPath && row.bindingRootId && row.relativePath
      ? { canonicalPath: row.canonicalPath, relativePath: row.relativePath, bindingRootId: row.bindingRootId }
      : null,
  }
}

async function resolveByPath(path: string) {
  const row = await tauriCatalogResolvePathDouble(await desktopDbPath(), path)
  return row ? { id: row.id } : null
}

async function allCatalogIds(): Promise<string[]> {
  const rows = await tauriCatalogListDouble(await desktopDbPath())
  return rows.map((row) => row.id)
}

async function listWorkspaceFiles(): Promise<string[]> {
  const files = await tauriListRecentFilesDouble(await writingsDir(), 10_000)
  return files.map((f) => f.path)
}

async function desktopDbPath(): Promise<string> {
  const { appConfigDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appConfigDir(), "desktop-index.sqlite3")
}

async function writingsDir(): Promise<string> {
  const { appDataDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appDataDir(), "Writings")
}
