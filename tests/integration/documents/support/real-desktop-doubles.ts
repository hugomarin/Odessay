import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import type {
  DesktopCatalogDualWriteInput,
  DesktopCatalogRow,
  DesktopFileMetadata,
  DesktopRetiredBindingRoot,
  DesktopWorkspaceFile,
  DesktopWorkspaceSnapshot,
  DesktopWorkspaceTouchResult,
} from "@/lib/services/desktop/tauri-commands"
import { WriteFileConflictError } from "@/lib/services/desktop/write-file-conflict-error"
import { computeMarkdownContentHash } from "@/lib/content-hash"

/**
 * Real (not mocked) stand-ins for the Tauri IPC boundary used by
 * `FilesystemDocumentService`/`SqliteDocumentCatalog`. Every function here
 * does genuine work — real fs reads/writes against a temp directory, real
 * hashing, a real in-memory catalog with the same id/path/binding
 * consistency rules the Rust side enforces (mirrored from
 * `sqlite-document-catalog.ts`'s `toRecord`) — instead of a trivial
 * call-counting Map. What's NOT real is the native Tauri transport itself
 * (no bridge exists in Vitest) and SQLite specifically (an in-memory row
 * store stands in for it). That seam — TS -> real `invoke()` -> real
 * Rust/SQLite — stays a deliberately separate, still-open gap (tracked in
 * workflow/quality/capability-integration-map.md, SYS-05/SYS-08), not
 * something this double claims to close.
 */

let configDir = ""
let dataDir = ""

const catalogsByDb = new Map<string, Map<string, DesktopCatalogRow>>()
const bindingRootIdsByRoot = new Map<string, string>()

/** Point the `@tauri-apps/api/path` double at a real temp directory. Call once per test file, before the first production call that resolves desktop runtime services. */
export function configureRealDesktopDoubles(baseDir: string): void {
  configDir = join(baseDir, "config")
  dataDir = join(baseDir, "data")
}

/** Clears all in-memory catalog state. Does not touch the real filesystem. */
export function resetCatalogDoubles(): void {
  catalogsByDb.clear()
  bindingRootIdsByRoot.clear()
}

function rowsFor(dbPath: string): Map<string, DesktopCatalogRow> {
  let rows = catalogsByDb.get(dbPath)
  if (!rows) {
    rows = new Map()
    catalogsByDb.set(dbPath, rows)
  }
  return rows
}

function bindingRootFor(rootPath: string): string {
  let id = bindingRootIdsByRoot.get(rootPath)
  if (!id) {
    id = randomUUID()
    bindingRootIdsByRoot.set(rootPath, id)
  }
  return id
}

/**
 * Must agree with the real Rust `content_hash_for_markdown_file`
 * (blake3 over CRLF-canonicalized markdown) — this is what feeds
 * `binding.contentHash` in the catalog, which `PersistenceCoordinator`'s
 * WATCH-07 write-side guard treats as the durable baseline. A different
 * algorithm here (the original SHA-256 predates that guard and never needed
 * to match anything outside itself) would make every second save on the
 * same document look like a spurious external conflict, since the
 * conflict-check double (tauriWriteFileDouble, below) already uses the
 * real one.
 */
async function hashFile(path: string): Promise<string> {
  const content = await fs.readFile(path, "utf8")
  return computeMarkdownContentHash(content)
}

async function statAsWorkspaceFile(rootPath: string, relativePath: string, documentId: string): Promise<DesktopWorkspaceFile> {
  const fullPath = join(rootPath, relativePath)
  const stat = await fs.stat(fullPath)
  const contentHash = await hashFile(fullPath)
  return {
    id: documentId,
    path: fullPath,
    relativePath,
    name: relativePath.split("/").pop() ?? relativePath,
    modifiedAt: stat.mtimeMs,
    size: stat.size,
    inode: stat.ino,
    contentHash,
  }
}

// ─── @tauri-apps/api/path double ───────────────────────────────────────────

export const tauriPathModuleDouble = {
  appConfigDir: async () => configDir,
  appDataDir: async () => dataDir,
  join: async (...parts: string[]) => join(...parts),
}

// ─── filesystem tauri-commands doubles (real fs) ───────────────────────────

/**
 * Simulates a write failure (e.g. disk full) on a specific `tauriWriteFile`
 * call, counting from 1 across all calls since the last reset. Failing "the
 * next call" isn't precise enough here: `FilesystemDocumentService.createDraft`
 * already writes a trivial placeholder before persist() writes the real
 * content, so "next" would hit the wrong one unless a caller carefully
 * avoids ever triggering that placeholder — this counts instead.
 */
let writeFileCallCount = 0
let failingWriteFileCallNumber: number | null = null
let writeFileFailureFactory: (() => never) | null = null
export function failWriteFileOnCall(callNumber: number, makeError: () => never): void {
  failingWriteFileCallNumber = callNumber
  writeFileFailureFactory = makeError
}
export function resetWriteFileFailureState(): void {
  writeFileCallCount = 0
  failingWriteFileCallNumber = null
  writeFileFailureFactory = null
}

export async function tauriCreateFileDouble(dir: string, filename: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const path = join(dir, filename)
  await fs.writeFile(path, "", { flag: "wx" })
  return path
}

/**
 * Mirrors the real Rust `write_file` command's WATCH-07 conflict guard: when
 * `expectedContentHash` is provided, the file's *current* on-disk content
 * (via the same `computeMarkdownContentHash` the app itself uses to compute
 * baselines, so this double agrees with production code on what "changed"
 * means) must match it, or the write is refused exactly like the real
 * command refuses it — same error shape (`WriteFileConflictError`), same
 * "disk stays untouched" guarantee.
 */
export async function tauriWriteFileDouble(
  path: string,
  content: string,
  expectedContentHash?: string | null,
): Promise<void> {
  writeFileCallCount += 1
  if (failingWriteFileCallNumber === writeFileCallCount) {
    const fail = writeFileFailureFactory!
    failingWriteFileCallNumber = null
    writeFileFailureFactory = null
    fail()
  }

  if (expectedContentHash) {
    let actual: string
    try {
      const currentContent = await fs.readFile(path, "utf8")
      actual = await computeMarkdownContentHash(currentContent)
    } catch {
      throw new WriteFileConflictError(`CONFLICT: ${path} no longer exists on disk (expected content hash ${expectedContentHash})`)
    }
    if (actual !== expectedContentHash) {
      throw new WriteFileConflictError(
        `CONFLICT: ${path} changed on disk since it was last read (expected ${expectedContentHash}, found ${actual})`,
      )
    }
  }

  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, content, "utf8")
}

export async function tauriOpenFileDouble(path: string): Promise<string> {
  return fs.readFile(path, "utf8")
}

/**
 * Mirrors the real Rust `relocate_file` (document.rs): the source must
 * exist, the destination's parent directories are created as needed, saving
 * onto the file's own current (canonical) location is a no-op rather than a
 * collision, and any real collision at the requested path resolves to the
 * next free "Name 2.md"/"Name 3.md" — a real `fs.rename`, never a copy, so a
 * cross-BindingRoot move genuinely leaves nothing behind at the old path.
 */
export async function tauriRelocateFileDouble(oldPath: string, newPath: string): Promise<string> {
  const sourceStat = await fs.stat(oldPath).catch(() => null)
  if (!sourceStat || !sourceStat.isFile()) {
    throw new Error(`relocate_file: source not found: ${oldPath}`)
  }

  await fs.mkdir(dirname(newPath), { recursive: true })

  const [canonicalSource, canonicalRequested] = await Promise.all([
    fs.realpath(oldPath).catch(() => null),
    fs.realpath(newPath).catch(() => null),
  ])
  if (canonicalSource && canonicalRequested && canonicalSource === canonicalRequested) {
    return newPath
  }

  let target = newPath
  if (await fs.stat(target).then(() => true).catch(() => false)) {
    const ext = target.includes(".") ? target.slice(target.lastIndexOf(".")) : ""
    const withoutExt = ext ? target.slice(0, -ext.length) : target
    let counter = 2
    let candidate = `${withoutExt} ${counter}${ext}`
    while (await fs.stat(candidate).then(() => true).catch(() => false)) {
      counter += 1
      candidate = `${withoutExt} ${counter}${ext}`
    }
    target = candidate
  }

  await fs.rename(oldPath, target)
  return target
}

export async function tauriListRecentFilesDouble(dir: string, limit = 200): Promise<DesktopFileMetadata[]> {
  await fs.mkdir(dir, { recursive: true })
  const names = await fs.readdir(dir)
  const metas = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name)
      const stat = await fs.stat(path)
      return { path, name, modifiedAt: stat.mtimeMs, size: stat.size }
    }),
  )
  return metas.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit)
}

// ─── manifest tauri-commands doubles (real fs stat/hash, no separate manifest file) ───
// The manifest itself (a persisted workspace index) is out of scope for the
// document-lifecycle scenarios this double supports (DOC-02/03/06) — those
// exercise the service API, not the external-watcher/manifest-scan path
// (that's WS-*/WATCH-* territory). Real values are still derived from the
// real file on disk, which is what the caller (`persist()` in
// document-service-factory.ts) actually reads back for its consistency
// checks (contentHash, size, relativePath).

export async function tauriWorkspaceTouchFileDouble(
  rootPath: string,
  relativePath: string,
  documentId: string,
): Promise<DesktopWorkspaceTouchResult> {
  const file = await statAsWorkspaceFile(rootPath, relativePath, documentId)
  return { status: "updated", rootPath, bindingRootId: bindingRootFor(rootPath), file }
}

export async function tauriWorkspaceSyncDouble(
  rootPath: string,
  _selectedPaths: string[] | undefined,
  documentIds: Record<string, string>,
): Promise<DesktopWorkspaceSnapshot> {
  const entries = Object.entries(documentIds)
  const files = await Promise.all(
    entries.map(([relativePath, id]) => statAsWorkspaceFile(rootPath, relativePath, id)),
  )
  const bindingRootId = bindingRootFor(rootPath)
  return {
    rootPath,
    bindingRootId,
    name: rootPath.split("/").pop() ?? rootPath,
    fileCount: files.length,
    folderCount: 0,
    updatedAt: Date.now(),
    selectedPaths: [],
    files,
    unboundPaths: [],
  }
}

// ─── catalog tauri-commands doubles (real in-memory row store) ────────────

function applyDualWrite(rows: Map<string, DesktopCatalogRow>, input: DesktopCatalogDualWriteInput): void {
  const prior = rows.get(input.document.id)
  const row: DesktopCatalogRow = {
    ...input.document,
    bindingRootId: input.binding?.bindingRootId ?? prior?.bindingRootId ?? null,
    relativePath: input.binding?.relativePath ?? prior?.relativePath ?? null,
    canonicalPath: input.binding?.canonicalPath ?? prior?.canonicalPath ?? null,
    inode: input.binding?.inode ?? prior?.inode ?? null,
    contentHash: input.binding?.contentHash ?? prior?.contentHash ?? null,
    size: input.binding?.size ?? prior?.size ?? null,
    lastSeenAt: input.binding?.lastSeenAt ?? prior?.lastSeenAt ?? null,
    excerpt: prior?.excerpt ?? null,
    excerptContentHash: prior?.excerptContentHash ?? null,
  }
  rows.set(row.id, row)
}

export async function tauriCatalogDualWriteDouble(dbPath: string, input: DesktopCatalogDualWriteInput): Promise<void> {
  applyDualWrite(rowsFor(dbPath), input)
}

/** Set to make the next tauriCatalogBulkDualWrite reject before applying any row — a real bulk write is one transaction, so a failure must not partially land. Auto-clears after firing once. */
let nextBulkDualWriteFailure: (() => never) | null = null
export function failNextBulkDualWrite(makeError: () => never): void {
  nextBulkDualWriteFailure = makeError
}

export async function tauriCatalogBulkDualWriteDouble(dbPath: string, inputs: DesktopCatalogDualWriteInput[]): Promise<string[]> {
  if (nextBulkDualWriteFailure) {
    const fail = nextBulkDualWriteFailure
    nextBulkDualWriteFailure = null
    fail()
  }
  const rows = rowsFor(dbPath)
  for (const input of inputs) applyDualWrite(rows, input)
  return inputs.map((input) => input.document.id)
}

export async function tauriCatalogGetByIdDouble(dbPath: string, id: string): Promise<DesktopCatalogRow | null> {
  return rowsFor(dbPath).get(id) ?? null
}

export async function tauriCatalogResolvePathDouble(dbPath: string, path: string): Promise<DesktopCatalogRow | null> {
  for (const row of rowsFor(dbPath).values()) {
    if (row.canonicalPath === path) return row
  }
  return null
}

export async function tauriCatalogListDouble(dbPath: string): Promise<DesktopCatalogRow[]> {
  return [...rowsFor(dbPath).values()]
}

/**
 * No test using this double ever retires a BindingRoot, so this always
 * returns empty — a real, minimal shape of "nothing to recover," not a
 * shortcut around the property under test. `DesktopWorkspaceService.
 * readRecords()` calls this on every read via `recoverInterruptedWorkspaceRemovals`
 * and short-circuits immediately when it's empty.
 */
export async function tauriCatalogListRetiredBindingRootsDouble(_dbPath: string): Promise<DesktopRetiredBindingRoot[]> {
  return []
}

export async function tauriCatalogDetachLocalFileDouble(dbPath: string, id: string): Promise<void> {
  const rows = rowsFor(dbPath)
  const row = rows.get(id)
  if (!row) return
  rows.set(id, { ...row, bindingRootId: null, relativePath: null, canonicalPath: null, inode: null, contentHash: null, size: null, lastSeenAt: null })
}

// ─── settings tauri-commands doubles (real in-memory key/value store) ─────
// Not the focus of any Proof Contract that uses this file (that's the JSON
// blob DesktopSettingsService reads/writes vocabulary items from/to) — a
// real, working, non-mocked store is still used rather than vi.fn() spies,
// consistent with the rest of this file, but its own durability isn't
// what's under test.

const settingsByStore = new Map<string, unknown>()

function settingsStoreKey(configDir: string, key: string): string {
  return `${configDir}::${key}`
}

// These replace the *exported* tauriSettingsRead/Write (which already do
// their own JSON.stringify/parse around the lower-level `invoke()` call) —
// not the native "settings_read"/"settings_write" IPC commands themselves —
// so this double stores/returns the plain value directly.
export async function tauriSettingsReadDouble(configDir: string, key: string): Promise<unknown> {
  return settingsByStore.get(settingsStoreKey(configDir, key)) ?? null
}

export async function tauriSettingsWriteDouble(configDir: string, key: string, value: unknown): Promise<void> {
  // Round-trip through JSON, matching the real function's own serialization
  // boundary — a live object reference held elsewhere must not let a test
  // mutate "durable" settings state indirectly.
  settingsByStore.set(settingsStoreKey(configDir, key), JSON.parse(JSON.stringify(value)))
}

export async function tauriSettingsDeleteDouble(configDir: string, key: string): Promise<void> {
  settingsByStore.delete(settingsStoreKey(configDir, key))
}

export function resetSettingsStoreDouble(): void {
  settingsByStore.clear()
}
