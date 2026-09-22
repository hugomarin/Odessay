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

type WritingRecordLike = { id: string; createdAt: string; version: number; title: string | null; status: string; artifactType: string; visibility: string }

function snapshotFor(record: WritingRecordLike, text: string) {
  return {
    writingId: record.id,
    createdAt: record.createdAt,
    version: record.version,
    title: record.title ?? "Untitled",
    bodyJson: bodyJson(text),
    bodyText: text,
    status: record.status as "draft",
    artifactType: record.artifactType as "general",
    visibility: record.visibility as "private",
    lifecycle: "local-only" as const,
  }
}

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
  // getDocumentService() memoizes the runtime (same config/data dirs for the
  // whole file, since it's keyed on the first resolveDesktopRuntimeServices()
  // call), so the temp root itself can't be swapped per test — but leaving
  // real files behind between tests would mean every test after the first
  // starts with "catalog = clean, filesystem = leftovers from a previous
  // test", which is exactly the kind of fs/catalog divergence this suite
  // exists to catch. Clear the real content, keep the root.
  rmSync(join(workspaceRoot, "data"), { recursive: true, force: true })
  rmSync(join(workspaceRoot, "config"), { recursive: true, force: true })
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
 * Then: no success is reported, and no catalog row exists for that id.
 * A real .md placeholder file *can* remain on disk (FilesystemDocumentService
 * creates it before persist() attempts the content write) — that is an
 * accepted, recoverable state by product decision, not a bug: a file with no
 * catalog row is exactly what the reconciler exists to adopt or clean up
 * (SYS-06/SYS-07/SYS-08 territory), so persist() does not roll it back
 * itself. This test asserts that state precisely instead of ignoring it.
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

  it("FAILURE — a filesystem write failure reports no success and leaves no catalog row (an orphan file may remain — accepted, see Proof Contract)", async () => {
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

    // Accepted, documented current behavior (product decision — see Proof
    // Contract above): FilesystemDocumentService.createDraft's placeholder
    // write (call #1) already landed before persist()'s content write
    // (call #2, the one that failed) — so a real orphan .md file remains,
    // with no catalog row pointing to it. Asserting this explicitly, rather
    // than only checking the catalog, is the point: the original version of
    // this test only checked catalog rows and would have stayed green even
    // if persist() started silently deleting files it shouldn't.
    const files = await listWorkspaceFiles()
    expect(files).toHaveLength(1)
  })
})

/**
 * DOC-03 — Save document (+ RACE variant, DOC-04's property)
 *
 * Property: confirmed content is saved durably and recoverable; a stale
 * save that settles after a newer one must never overwrite it (DOC-04's
 * property, exercised here rather than as a separate scenario per the
 * capability map's "don't invent new capabilities for a variant" guidance).
 *
 * Real collaborators: PersistenceCoordinator (real) — the chain this
 * scenario declares starts at the coordinator, not at DocumentService
 * directly, so both cases below go through `coordinator.persist(...)` +
 * `coordinator.settle(...)`, never a raw `service.saveWriting(...)` call.
 * `settle()` is the coordinator's own public contract for "wait until
 * nothing is in flight, debounced or queued for this document" — its JSDoc
 * says exactly this is for a caller that needs to know a write has actually
 * landed. An earlier version of this test invented a private signal around
 * `saveWriting` instead of using it; that was unnecessary and coupled the
 * test to an implementation detail instead of the coordinator's own API.
 * Allowed fakes: same as DOC-02, plus a controlled delay wrapped around the
 * *first* saveWriting call only, for the RACE case — the delay itself is
 * test control, not a fake of behavior; the real save still executes
 * underneath it.
 */
describe("DOC-03 — Save document", () => {
  it("persists new content durably through the coordinator and it is recoverable from the real file and via reopen", async () => {
    const draft = await createDesktopDraft({ title: "Save Target", initialBodyJson: bodyJson("v1") })
    const record = draft.data!
    const service = await getDocumentService()

    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      persistenceDebounceMs: 0,
      documentService: service,
      createWritingId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })

    coordinator.persist(snapshotFor(record, "v2"))
    await coordinator.settle({ writingId: record.id })

    const catalogRow = await getCatalogRecord(record.id)
    const canonicalPath = catalogRow!.binding!.canonicalPath
    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toContain("v2")
    expect(onDisk).not.toContain("v1")

    const reopened = await service.openWriting(record.id)
    expect(reopened.data!.content.plainText).toContain("v2")
  })

  it("RACE — a stale save that settles after a newer one does not overwrite the newer content", async () => {
    const draft = await createDesktopDraft({ title: "Race Target", initialBodyJson: bodyJson("initial") })
    const record = draft.data!
    const service = await getDocumentService()

    let releaseFirstSave: (() => void) | null = null
    let saveCallCount = 0
    const realSaveWriting = service.saveWriting.bind(service)
    const delayedSaveWriting: typeof service.saveWriting = async (input) => {
      saveCallCount += 1
      if (saveCallCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve
        })
      }
      return realSaveWriting(input)
    }

    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      persistenceDebounceMs: 0,
      documentService: { saveWriting: delayedSaveWriting },
      createWritingId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })

    coordinator.persist(snapshotFor(record, "SAVE A — should lose the race"))
    await vi.waitFor(() => expect(saveCallCount).toBe(1))

    coordinator.persist(snapshotFor(record, "SAVE B — should win the race"))
    // B must not have started its own saveWriting call yet — the coordinator
    // collapses it into the single pending slot for this document.
    expect(saveCallCount).toBe(1)

    releaseFirstSave!()
    // The coordinator's own public durability contract: wait until nothing
    // is in flight, debounced or queued for this document, rather than
    // trusting the timing of persist()'s own returned promises (persist()
    // is documented as optimistic/fire-and-forget; settle() is the API for
    // "I need to know it actually landed").
    await coordinator.settle({ writingId: record.id })

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
