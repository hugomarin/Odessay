import { promises as fs } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import type {
  DesktopCatalogDualWriteInput,
  DesktopCatalogRow,
  DesktopFileMetadata,
  DesktopWorkspaceFile,
  DesktopWorkspaceSnapshot,
  DesktopWorkspaceTouchResult,
} from "@/lib/services/desktop/tauri-commands"

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

async function hashFile(path: string): Promise<string> {
  const content = await fs.readFile(path, "utf8")
  return createHash("sha256").update(content).digest("hex")
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

export async function tauriWriteFileDouble(path: string, content: string): Promise<void> {
  writeFileCallCount += 1
  if (failingWriteFileCallNumber === writeFileCallCount) {
    const fail = writeFileFailureFactory!
    failingWriteFileCallNumber = null
    writeFileFailureFactory = null
    fail()
  }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, content, "utf8")
}

export async function tauriOpenFileDouble(path: string): Promise<string> {
  return fs.readFile(path, "utf8")
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

export async function tauriCatalogDualWriteDouble(dbPath: string, input: DesktopCatalogDualWriteInput): Promise<void> {
  const rows = rowsFor(dbPath)
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

export async function tauriCatalogDetachLocalFileDouble(dbPath: string, id: string): Promise<void> {
  const rows = rowsFor(dbPath)
  const row = rows.get(id)
  if (!row) return
  rows.set(id, { ...row, bindingRootId: null, relativePath: null, canonicalPath: null, inode: null, contentHash: null, size: null, lastSeenAt: null })
}
