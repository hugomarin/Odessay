/** @vitest-environment happy-dom */
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  configureRealDesktopDoubles,
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

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for WATCH-07 and was not expected to be called`)
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

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { createPersistenceCoordinator } = await import("@/lib/editor/persistence-coordinator")
const { computeMarkdownContentHash } = await import("@/lib/content-hash")

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
  workspaceRoot = mkdtempSync(join(tmpdir(), "odessay-watch07-"))
  configureRealDesktopDoubles(workspaceRoot)
})

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

afterEach(() => {
  resetCatalogDoubles()
  resetWriteFileFailureState()
  rmSync(join(workspaceRoot, "data"), { recursive: true, force: true })
  rmSync(join(workspaceRoot, "config"), { recursive: true, force: true })
})

/**
 * WATCH-07 — the write-side conflict guard is the "final barrier" half of
 * the property: no save may durably overwrite a durable external edit
 * unless the caller explicitly chose to replace it. `PersistenceCoordinator`
 * owns the durable-content-hash baseline itself (getDurableContentHash /
 * setDurableContentHash) and only ever advances it after a real durable
 * commit — never optimistically from a caller's snapshot, and never frozen
 * at persist()-call time — specifically so that a second save queued behind
 * a first one sees the first save's own just-landed result, not a stale
 * pre-first-save value (review caught this: the original version threaded a
 * caller-supplied baseline through the snapshot object itself, which raced
 * exactly that sequence).
 *
 * Real collaborators: PersistenceCoordinator (real), FilesystemDocumentService
 * (real class) — the same real fs + real behavioral tauriWriteFile double
 * used by DOC-02/03/06, extended with the identical hash-comparison logic
 * the real Rust `write_file` command has (see its own cargo tests for that
 * half). The double's own manifest-sync hash (statAsWorkspaceFile) was
 * corrected in this same change to use the same blake3 algorithm as the
 * conflict check — it previously used SHA-256, which predates this guard
 * and never needed to agree with anything outside itself; once seeded as a
 * baseline, that mismatch alone made every second save look like a conflict.
 * Allowed fakes: same as DOC-02/03/06 (native Tauri transport, cloud sync).
 */
describe("WATCH-07 — write-side conflict guard", () => {
  it("a save with a correct baseline succeeds normally (control)", async () => {
    const draft = await createDesktopDraft({ title: "Clean Save", initialBodyJson: bodyJson("v1") })
    const record = draft.data!
    const service = await getDocumentService()

    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      persistenceDebounceMs: 0,
      documentService: service,
      createWritingId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })

    coordinator.persist(snapshotFor(record, "v2 — my edit"))
    await coordinator.settle({ writingId: record.id })

    const catalogRow = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
    const canonicalPath = catalogRow!.canonicalPath!
    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toContain("v2 — my edit")
  })

  it("RACE — an external write that lands after the baseline was read wins; the local save is refused as CONFLICT and disk is untouched", async () => {
    const draft = await createDesktopDraft({ title: "Race Target", initialBodyJson: bodyJson("v1") })
    const record = draft.data!
    const service = await getDocumentService()
    const catalogRow = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
    const canonicalPath = catalogRow!.canonicalPath!
    const originalContent = await readFile(canonicalPath, "utf8")
    const staleBaseline = await computeMarkdownContentHash(originalContent)

    const errorEvents: Array<{ code?: string; message: string }> = []
    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        persistenceDebounceMs: 0,
        documentService: service,
        createWritingId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      },
      {
        onError: (event) => {
          if (event.error) errorEvents.push({ code: event.error.code, message: event.error.message })
        },
      },
    )
    // Seed the coordinator's tracked baseline explicitly, as editor-shell.tsx
    // would after opening the document — this is the value the RACE is
    // against: the caller confirmed H1, then something else changed the
    // file to H2 before this save's own write actually executes.
    coordinator.setDurableContentHash(record.id, staleBaseline)

    // Simulate the external edit: another process writes the file directly,
    // bypassing the app entirely — exactly what the watcher would detect,
    // except this test's point is that detection is *not* what prevents the
    // overwrite; the write-side hash check is.
    const fs = await import("node:fs/promises")
    await fs.writeFile(canonicalPath, "# External Edit\n\nSomeone else's content.\n", "utf8")

    // Local edit was scheduled against the OLD (now-stale) baseline —
    // exactly the RACE: the caller read H1, the external write to H2
    // happened, and only *then* does this local persist actually run.
    coordinator.persist(snapshotFor(record, "my conflicting local edit"))
    await coordinator.settle({ writingId: record.id })

    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toBe("# External Edit\n\nSomeone else's content.\n")
    expect(onDisk).not.toContain("my conflicting local edit")

    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0]!.code).toBe("CONFLICT")
    expect(errorEvents[0]!.message).toContain("CONFLICT:")
  })

  it("a save with no baseline at all (first save of a brand-new draft) is never refused", async () => {
    const draft = await createDesktopDraft({ title: "Brand New", initialBodyJson: bodyJson("v1") })
    const record = draft.data!
    const service = await getDocumentService()

    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      persistenceDebounceMs: 0,
      documentService: service,
      createWritingId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })

    // No setDurableContentHash call at all — must behave exactly as before
    // this guard existed.
    coordinator.persist(snapshotFor(record, "v2"))
    await coordinator.settle({ writingId: record.id })

    const catalogRow = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
    const onDisk = await readFile(catalogRow!.canonicalPath!, "utf8")
    expect(onDisk).toContain("v2")
  })

  /**
   * The exact scenario review required: two of the app's *own* sequential
   * saves for the same document, the second queued behind the first while
   * it's still in flight. Neither is external — this must never produce a
   * spurious CONFLICT, and the coordinator's baseline must have advanced to
   * A's real durable hash by the time B's write actually executes, or B
   * would wrongly appear to conflict with its own predecessor.
   */
  it("SEQUENTIAL — a save queued behind an in-flight save for the same document advances the baseline correctly and never conflicts with itself", async () => {
    const draft = await createDesktopDraft({ title: "Sequential Target", initialBodyJson: bodyJson("initial") })
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

    const errorEvents: Array<{ code?: string; message: string }> = []
    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        persistenceDebounceMs: 0,
        documentService: { saveWriting: delayedSaveWriting },
        createWritingId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      },
      {
        onError: (event) => {
          if (event.error) errorEvents.push({ code: event.error.code, message: event.error.message })
        },
      },
    )

    const catalogRow = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
    const canonicalPath = catalogRow!.canonicalPath!
    const initialContent = await readFile(canonicalPath, "utf8")
    coordinator.setDurableContentHash(record.id, await computeMarkdownContentHash(initialContent))

    coordinator.persist(snapshotFor(record, "SAVE A — first, in flight"))
    await vi.waitFor(() => expect(saveCallCount).toBe(1))

    coordinator.persist(snapshotFor(record, "SAVE B — queued behind A"))
    // B must not have started its own saveWriting call yet — the coordinator
    // collapses it into the single pending slot for this document.
    expect(saveCallCount).toBe(1)

    releaseFirstSave!()
    await coordinator.settle({ writingId: record.id })

    expect(errorEvents).toEqual([])
    const onDisk = await readFile(canonicalPath, "utf8")
    expect(onDisk).toContain("SAVE B")
    expect(onDisk).not.toContain("SAVE A")
  })
})

async function desktopDbPath(): Promise<string> {
  const { appConfigDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appConfigDir(), "desktop-index.sqlite3")
}
