import { promises as fs } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import type {
  DesktopCatalogCollectionSnapshot,
  DesktopCatalogDualWriteInput,
  DesktopCatalogMetadataMutation,
  DesktopCatalogMutationRow,
  DesktopCatalogReconcileInput,
  DesktopCatalogReconcileResult,
  DesktopCatalogRow,
  DesktopCloudSnapshotInput,
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
// Per-root durable manifest state (relativePath -> document id), real enough
// to prove Workspace-manifest convergence (WS-02): an explicit-IDs call binds
// entries into it; a no-IDs call (production's own "rescan/reconcile this
// root" form) drops any entry whose file no longer exists on real disk —
// exactly what a real directory rescan would find after a relocate moved the
// file elsewhere. Not a full manifest file/versioning model (that stays out
// of scope, per the note below) — just enough state to answer "does this
// root still claim this document" truthfully.
const manifestsByRoot = new Map<string, Map<string, string>>()
// Last inode seen for each manifest entry (rootPath -> relativePath -> inode),
// the evidence the real `workspace_sync` keeps per entry to follow a file that
// was renamed or moved inside the root outside the app (ODE-599, WATCH-04).
const manifestInodesByRoot = new Map<string, Map<string, number>>()
// The manifest's persisted scope per root, as `.odessay/index.json` keeps it:
// a call with `selectedPaths` replaces it, a call without one reuses it
// (`workspace.rs` `uses_persisted_selection`). Empty means the whole root.
const selectedPathsByRoot = new Map<string, string[]>()

/**
 * Cola durable de sync (`sync_mutations`), en memoria. Espeja las tres reglas
 * de Rust que `desktopCatalogSyncService` usa por IPC:
 *
 * - supersede al escribir un snapshot nuevo (`index.rs:700-716` en dual-write,
 *   `:1455-1462` en enqueue): las mutaciones `pending`/`failed` anteriores del
 *   mismo documento pasan a `synced` con `last_error` "superseded…", y solo
 *   queda accionable la última;
 * - listado de pendientes (`:1482-1518`): `pending` siempre, `failed` solo con
 *   `include_failed` y `attempt_count < MAX_SYNC_ATTEMPTS`, filtrado por
 *   `next_retry_at <= now` y ordenado por `created_at ASC`;
 * - proyección de estado del documento (`:1409-1443`), reproducida tal cual
 *   —incluida la ausencia de guarda de estado previo de `:1422-1424`— porque
 *   es el comportamiento bajo prueba en ODE-611/614.
 *
 * No es SQLite real: el transporte Tauri se dobla, como en el resto del
 * archivo. La fidelidad con Rust sale de leer el SQL citado.
 */
type SyncMutationRow = {
  id: string
  documentId: string
  operation: "upsert" | "delete"
  payloadJson: string
  status: "pending" | "processing" | "synced" | "failed"
  attemptCount: number
  nextRetryAt: number | null
  createdAt: number
  lastError: string | null
}

/** Igual que `MAX_SYNC_ATTEMPTS` en `src-tauri/src/commands/index.rs:7`. */
const MAX_SYNC_ATTEMPTS = 10

const mutationsByDb = new Map<string, Map<string, SyncMutationRow>>()

/** Point the `@tauri-apps/api/path` double at a real temp directory. Call once per test file, before the first production call that resolves desktop runtime services. */
export function configureRealDesktopDoubles(baseDir: string): void {
  configDir = join(baseDir, "config")
  dataDir = join(baseDir, "data")
}

/** Clears all in-memory catalog state. Does not touch the real filesystem. */
export function resetCatalogDoubles(): void {
  catalogsByDb.clear()
  bindingRootIdsByRoot.clear()
  manifestsByRoot.clear()
  manifestInodesByRoot.clear()
  selectedPathsByRoot.clear()
  mutationsByDb.clear()
  for (const gate of [...catalogReadGates]) gate.release()
}

type CatalogReadGate = { matches: (idOrPath: string) => boolean; hits: number; opened: Promise<void>; release: () => void }
let catalogReadGates: CatalogReadGate[] = []

/**
 * Retiene las lecturas de fila del catálogo (`getById`, `resolvePath`) cuyo id
 * o ruta cumpla `matches`, hasta `release()`. La lectura se hace de verdad al
 * soltarla; solo cambia cuándo.
 *
 * Sirve para parar un opener justo en su frontera asíncrona — la lectura de la
 * fila del documento que va a abrir — y observar qué hizo la shell antes de
 * esperar (ODE-580). `hits()` es el control positivo: la lectura retenida
 * ocurrió.
 */
export function holdCatalogReads(matches: (idOrPath: string) => boolean): { hits: () => number; release: () => void } {
  let open!: () => void
  const gate: CatalogReadGate = {
    matches,
    hits: 0,
    opened: new Promise<void>((resolve) => {
      open = resolve
    }),
    release: () => {
      catalogReadGates = catalogReadGates.filter((candidate) => candidate !== gate)
      open()
    },
  }
  catalogReadGates.push(gate)
  return { hits: () => gate.hits, release: gate.release }
}

async function passCatalogReadGates(idOrPath: string): Promise<void> {
  const gate = catalogReadGates.find((candidate) => candidate.matches(idOrPath))
  if (!gate) return
  gate.hits += 1
  await gate.opened
}

function manifestFor(rootPath: string): Map<string, string> {
  let manifest = manifestsByRoot.get(rootPath)
  if (!manifest) {
    manifest = new Map()
    manifestsByRoot.set(rootPath, manifest)
  }
  return manifest
}

function rowsFor(dbPath: string): Map<string, DesktopCatalogRow> {
  let rows = catalogsByDb.get(dbPath)
  if (!rows) {
    rows = new Map()
    catalogsByDb.set(dbPath, rows)
  }
  return rows
}

function mutationsFor(dbPath: string): Map<string, SyncMutationRow> {
  let mutations = mutationsByDb.get(dbPath)
  if (!mutations) {
    mutations = new Map()
    mutationsByDb.set(dbPath, mutations)
  }
  return mutations
}

/**
 * Espejo del `UPDATE sync_mutations … WHERE document_id=?1 AND id<>?2 AND
 * status IN ('pending','failed')` de `apply_dual_write` (`index.rs:704-711`).
 */
function supersedeOlderMutations(
  mutations: Map<string, SyncMutationRow>,
  documentId: string,
  exceptId: string,
  lastError: string,
): void {
  for (const mutation of mutations.values()) {
    if (
      mutation.documentId === documentId &&
      mutation.id !== exceptId &&
      (mutation.status === "pending" || mutation.status === "failed")
    ) {
      mutation.status = "synced"
      mutation.nextRetryAt = null
      mutation.lastError = lastError
    }
  }
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
  renameFileFailure = null
  writeFileCallCount = 0
  failingWriteFileCallNumber = null
  writeFileFailureFactory = null
  heldWriteFile = null
  heldOpenFile = null
  failingWriteFileMatching = null
  writeFileLog.length = 0
  failingCatalogGetById.clear()
}

/**
 * Registro de cada `tauriWriteFile` que llegó al doble, en orden y ANTES de
 * cualquier retención o fallo: cuenta los intentos, no los que acabaron en
 * disco. Sirve para comprobar cuántos guardados arrancó la app mientras otro
 * seguía en vuelo (ODE-574, antes ODE-461). Se limpia con
 * `resetWriteFileFailureState`.
 */
const writeFileLog: Array<{ path: string; content: string }> = []
export function writeFileCalls(): ReadonlyArray<{ path: string; content: string }> {
  return [...writeFileLog]
}

/**
 * Hace fallar el próximo `tauriWriteFile` cuya ruta cumpla `matches`, como un
 * error del disco o de la base nativa. A diferencia de `failWriteFileOnCall`,
 * no depende de cuántas escrituras hubo antes. Se limpia con
 * `resetWriteFileFailureState`.
 */
let failingWriteFileMatching: { matches: (path: string) => boolean; makeError: () => never } | null = null
export function failNextWriteFile(matches: (path: string) => boolean, makeError: () => never): void {
  failingWriteFileMatching = { matches, makeError }
}

/**
 * Retiene el próximo `tauriWriteFile` cuya ruta cumpla `matches` hasta que se
 * llame a `release()`, como un disco lento. Sirve para observar lo que la app
 * muestra MIENTRAS un guardado está en vuelo (por ejemplo, cerrar una pestaña
 * con su guardado pendiente, ODE-574). `started()` resuelve cuando el write
 * retenido ya llegó.
 */
let heldWriteFile: { matches: (path: string) => boolean; gate: Promise<void>; arrived: () => void } | null = null
export function holdWriteFile(matches: (path: string) => boolean): { release: () => void; started: Promise<void> } {
  let release!: () => void
  let arrived!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  heldWriteFile = { matches, gate, arrived }
  return { release, started }
}

/**
 * Retiene la próxima lectura (`tauriOpenFile`) cuya ruta cumpla `matches`,
 * capturando el contenido en el momento en que la lectura llegó y
 * entregándolo cuando `release()` la suelta — aunque el archivo cambie
 * mientras está retenida. Modela una lectura en vuelo que aterriza tarde: la
 * ventana exacta en la que un snapshot leído antes de mover un archivo puede
 * pisar contenido más nuevo (ODE-629). `started()` resuelve cuando la lectura
 * llegó. Se limpia con `resetWriteFileFailureState`.
 */
let heldOpenFile: { matches: (path: string) => boolean; gate: Promise<void>; arrived: () => void } | null = null
export function holdOpenFile(matches: (path: string) => boolean): { release: () => void; started: Promise<void> } {
  let release!: () => void
  let arrived!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  heldOpenFile = { matches, gate, arrived }
  return { release, started }
}

/**
 * Hace fallar la lectura del catálogo SQLite (`catalog_get_by_id`) para un
 * documento concreto, como un error de la base de datos nativa. Abrir ese
 * documento devuelve entonces `DB_ERROR`, que la hidratación clasifica como
 * `open-error` (ODE-574, antes ODE-555). Se limpia con
 * `resetWriteFileFailureState`.
 */
const failingCatalogGetById = new Map<string, () => never>()
export function failCatalogGetById(documentId: string, makeError: () => never): void {
  failingCatalogGetById.set(documentId, makeError)
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
  writeFileLog.push({ path, content })
  if (heldWriteFile?.matches(path)) {
    const held = heldWriteFile
    heldWriteFile = null
    held.arrived()
    await held.gate
  }
  if (failingWriteFileMatching?.matches(path)) {
    const { makeError } = failingWriteFileMatching
    failingWriteFileMatching = null
    makeError()
  }
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

/**
 * Mirrors the real Rust `write_binary_file` command (src-tauri/src/commands/document.rs),
 * the export writer behind `saveDesktopBinaryExport`: create missing parent
 * dirs, write a `.tmp` sibling, rename it over the target, and drop the
 * `.tmp` if the rename fails. A write failure here is a genuine fs error
 * (e.g. a parent path component that is a plain file), never a scripted
 * throw (EXP-05, ODE-601).
 *
 * Failure shape: the command returns `Err(String)`, and Tauri's `invoke`
 * rejects with that bare string — not an `Error`. The double rejects the same
 * way, with the same message prefixes, so callers that branch on
 * `instanceof Error` see what production sees.
 */
export async function tauriWriteBinaryFileDouble(path: string, bytes: Uint8Array): Promise<void> {
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const parent = dirname(path)
  const parentExists = await fs.stat(parent).then(() => true, () => false)
  if (!parentExists) {
    try {
      await fs.mkdir(parent, { recursive: true })
    } catch (error) {
      return Promise.reject(`create_dir_all: ${reason(error)}`)
    }
  }
  const tmpPath = `${path}.tmp`
  try {
    await fs.writeFile(tmpPath, bytes)
  } catch (error) {
    return Promise.reject(`write_binary_file tmp: ${reason(error)}`)
  }
  try {
    await fs.rename(tmpPath, path)
  } catch (error) {
    await fs.rm(tmpPath, { force: true })
    return Promise.reject(`write_binary_file rename: ${reason(error)}`)
  }
}

/**
 * Mirrors the real Rust `rename_file` command: creates the destination's
 * parent directory and renames in place, returning the new path. It does not
 * resolve collisions — `FilesystemDocumentService.renameWriting` already
 * picked a free filename before calling it. `failNextRenameFile` makes the
 * next call fail like an OS error (ODE-585); cleared by
 * `resetWriteFileFailureState`.
 */
let renameFileFailure: (() => never) | null = null
export function failNextRenameFile(makeError: () => never): void {
  renameFileFailure = makeError
}
export async function tauriRenameFileDouble(oldPath: string, newPath: string): Promise<string> {
  if (renameFileFailure) {
    const fail = renameFileFailure
    renameFileFailure = null
    fail()
  }
  await fs.mkdir(dirname(newPath), { recursive: true })
  await fs.rename(oldPath, newPath)
  return newPath
}

export async function tauriOpenFileDouble(path: string): Promise<string> {
  if (heldOpenFile?.matches(path)) {
    const held = heldOpenFile
    heldOpenFile = null
    // Capture at arrival, deliver on release: the caller reads the file as it
    // was when the read was issued, even if it changes while held.
    const captured = await fs.readFile(path, "utf8")
    held.arrived()
    await held.gate
    return captured
  }
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
  selectedPaths: string[] | undefined,
  documentIds?: Record<string, string>,
): Promise<DesktopWorkspaceSnapshot> {
  const manifest = manifestFor(rootPath)
  if (selectedPaths) selectedPathsByRoot.set(rootPath, [...new Set(selectedPaths)])
  const effectiveSelectedPaths = selectedPathsByRoot.get(rootPath) ?? []

  // Adoption of an explicitly selected file: a `.md` named in `selectedPaths`
  // that exists on disk but has no manifest entry yet gets a fresh id, as the
  // real scan assigns one to an unbound file inside the selected scope. This
  // is the call the unified opener makes when a file from a folder outside
  // every BindingRoot is opened (`openDocumentByPath`, ODE-581). Only exact
  // file paths are adopted; unselected files stay out of the manifest, so
  // callers that never select anything see the same snapshot as before.
  for (const relativePath of selectedPaths ?? []) {
    if (!relativePath.endsWith(".md") || manifest.has(relativePath)) continue
    const isFile = await fs
      .stat(join(rootPath, relativePath))
      .then((stat) => stat.isFile())
      .catch(() => false)
    if (isFile) manifest.set(relativePath, randomUUID())
  }

  // Explicit-IDs form (the destination bind: relocateDesktopWriting passes
  // `{ [relativePath]: id }` for the file it just moved in) — durably record
  // the association, not just this one call's transient result.
  if (documentIds) {
    for (const [relativePath, id] of Object.entries(documentIds)) {
      manifest.set(relativePath, id)
    }
  }

  // Inode-correlated move recovery, mirroring the real scan: a manifest entry
  // whose file is gone keeps its id if a `.md` inside the same root that the
  // manifest does not know yet carries the inode last seen for it — a Finder
  // rename or move, never delete + create. Only unmanifested candidates are
  // considered, so an app-side rename that already bound its new path through
  // `documentIds` above just drops the stale entry below (ODE-599).
  const knownInodes = manifestInodesByRoot.get(rootPath)
  if (knownInodes) {
    let candidates: Array<{ relativePath: string; inode: number }> | null = null
    for (const [relativePath, id] of [...manifest.entries()]) {
      const inode = knownInodes.get(relativePath)
      if (!inode) continue
      const stillExists = await fs
        .stat(join(rootPath, relativePath))
        .then(() => true)
        .catch(() => false)
      if (stillExists) continue
      candidates ??= await listUnmanifestedMarkdown(rootPath, manifest)
      const moved: { relativePath: string; inode: number } | undefined = candidates.find((candidate) => candidate.inode === inode)
      if (!moved) continue
      manifest.delete(relativePath)
      knownInodes.delete(relativePath)
      manifest.set(moved.relativePath, id)
      candidates = candidates.filter((candidate) => candidate !== moved)
    }
  }

  // Reconcile-delete: runs on EVERY call, not just the no-IDs (origin-root
  // resync) form above — production's real rescan drops entries for files
  // it can no longer find on disk regardless of whether this same call also
  // carried an explicit id map, so this double does too, rather than
  // requiring (and previously crashing on the absence of) an explicit id map
  // whenever `documentIds` is omitted.
  for (const relativePath of [...manifest.keys()]) {
    const stillExists = await fs
      .stat(join(rootPath, relativePath))
      .then(() => true)
      .catch(() => false)
    if (!stillExists) manifest.delete(relativePath)
  }

  const files = await Promise.all(
    [...manifest.entries()].map(([relativePath, id]) => statAsWorkspaceFile(rootPath, relativePath, id)),
  )
  const inodes = new Map<string, number>()
  for (const file of files) inodes.set(file.relativePath, file.inode)
  manifestInodesByRoot.set(rootPath, inodes)
  const bindingRootId = bindingRootFor(rootPath)
  return {
    rootPath,
    bindingRootId,
    name: rootPath.split("/").pop() ?? rootPath,
    fileCount: files.length,
    folderCount: 0,
    updatedAt: Date.now(),
    selectedPaths: effectiveSelectedPaths,
    files,
    unboundPaths: [],
  }
}

/** Every `.md` under `rootPath` (outside `.odessay`) that `manifest` does not bind yet, with its real inode. */
async function listUnmanifestedMarkdown(
  rootPath: string,
  manifest: Map<string, string>,
): Promise<Array<{ relativePath: string; inode: number }>> {
  const found: Array<{ relativePath: string; inode: number }> = []
  async function walk(dir: string, prefix: string) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === ".odessay") continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, relativePath)
      } else if (entry.name.endsWith(".md") && !manifest.has(relativePath)) {
        found.push({ relativePath, inode: (await fs.stat(full)).ino })
      }
    }
  }
  await walk(rootPath, "")
  return found
}

// ─── catalog tauri-commands doubles (real in-memory row store) ────────────

function applyDualWrite(
  rows: Map<string, DesktopCatalogRow>,
  mutations: Map<string, SyncMutationRow>,
  input: DesktopCatalogDualWriteInput,
): void {
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
  if (input.mutation) {
    const mutation = input.mutation
    supersedeOlderMutations(mutations, input.document.id, mutation.id, "superseded by later snapshot mutation")
    const existing = mutations.get(mutation.id)
    if (existing) {
      // ON CONFLICT(id) DO UPDATE SET status,attempt_count,next_retry_at,last_error
      existing.status = mutation.status as SyncMutationRow["status"]
      existing.attemptCount = mutation.attemptCount
      existing.nextRetryAt = mutation.nextRetryAt
      existing.lastError = mutation.lastError
    } else {
      mutations.set(mutation.id, {
        id: mutation.id,
        documentId: input.document.id,
        operation: mutation.operation as SyncMutationRow["operation"],
        payloadJson: mutation.payloadJson,
        status: mutation.status as SyncMutationRow["status"],
        attemptCount: mutation.attemptCount,
        nextRetryAt: mutation.nextRetryAt,
        createdAt: mutation.createdAt,
        lastError: mutation.lastError,
      })
    }
  }
}

export async function tauriCatalogDualWriteDouble(dbPath: string, input: DesktopCatalogDualWriteInput): Promise<void> {
  applyDualWrite(rowsFor(dbPath), mutationsFor(dbPath), input)
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
  const mutations = mutationsFor(dbPath)
  for (const input of inputs) applyDualWrite(rows, mutations, input)
  return inputs.map((input) => input.document.id)
}

/**
 * Espejo de `catalog_apply_cloud_snapshots` (src-tauri/src/commands/index.rs).
 * Un snapshot de la nube actualiza los campos cloud, pero **no** mueve una
 * fila `pending`/`failed`/`conflict` a `synced`: eso lo hace la confirmación
 * de su mutación. Una fila sin estado pendiente pasa a `synced` si la nube la
 * tiene. Una fila que no existía entra como solo-nube.
 */
export async function tauriCatalogApplyCloudSnapshotsDouble(
  dbPath: string,
  snapshots: DesktopCloudSnapshotInput[],
): Promise<void> {
  const rows = rowsFor(dbPath)
  for (const snapshot of snapshots) {
    const prior = rows.get(snapshot.id)
    const keepsPending = prior && ["pending", "failed", "conflict"].includes(prior.syncStatus)
    const syncStatus = keepsPending ? prior.syncStatus : snapshot.cloudPresent ? "synced" : (prior?.syncStatus ?? "local-only")
    rows.set(snapshot.id, {
      ...(prior ?? {
        id: snapshot.id,
        localPresent: false,
        bindingRootId: null,
        relativePath: null,
        canonicalPath: null,
        inode: null,
        contentHash: null,
        size: null,
        lastSeenAt: null,
        excerpt: null,
        excerptContentHash: null,
      }),
      cloudPresent: snapshot.cloudPresent,
      cloudAccountId: snapshot.cloudAccountId,
      title: snapshot.title ?? prior?.title ?? null,
      slug: snapshot.slug ?? prior?.slug ?? null,
      status: snapshot.status ?? prior?.status ?? null,
      syncStatus,
    } as DesktopCatalogRow)
  }
}

/**
 * Espejo del efecto de `catalog_update_mutation_status(…, "synced")` sobre el
 * documento de una mutación **upsert** confirmada (src-tauri/src/commands/index.rs):
 * `sync_status='synced'` y `cloud_present=1`. En producción lo escribe el
 * servicio de sync de desktop al confirmar el write en la nube, y **no emite
 * ningún CatalogChange**: la única señal es el evento efímero `synced`
 * (ODE-542). Las pruebas lo usan como el efecto en disco de ese servicio, que
 * es el boundary doblado.
 */
export function confirmCatalogUpsertSyncedDouble(documentId: string): void {
  for (const rows of catalogsByDb.values()) {
    const row = rows.get(documentId)
    if (row) rows.set(documentId, { ...row, syncStatus: "synced", cloudPresent: true })
  }
}

export async function tauriCatalogGetByIdDouble(dbPath: string, id: string): Promise<DesktopCatalogRow | null> {
  await passCatalogReadGates(id)
  const failure = failingCatalogGetById.get(id)
  if (failure) failure()
  return rowsFor(dbPath).get(id) ?? null
}

/**
 * Espejo de `catalog_apply_reconcile` (src-tauri/src/commands/index.rs): una
 * ráfaga del WorkspaceReconciler en una sola transacción. Un upsert proyecta
 * la presencia local y el binding sin tocar los metadatos de la nube; un
 * detach quita el binding y marca `local_present=0`. `changed` solo lista los
 * ids cuyo binding guardado difería de verdad (ruta, inode o hash) o que
 * perdieron presencia: un rescan que reconfirma lo mismo no emite nada.
 *
 * Sin raíces retiradas en ningún test que use este doble, la valla de
 * retirada nunca aplica (mismo premisa que `tauriCatalogListRetiredBindingRootsDouble`).
 */
export async function tauriCatalogApplyReconcileDouble(
  dbPath: string,
  input: DesktopCatalogReconcileInput,
): Promise<DesktopCatalogReconcileResult> {
  const rows = rowsFor(dbPath)
  const changed: string[] = []
  for (const binding of input.upserts) {
    const prior = rows.get(binding.documentId)
    const unchanged =
      prior !== undefined &&
      prior.relativePath === binding.relativePath &&
      prior.canonicalPath === binding.canonicalPath &&
      prior.inode === binding.inode &&
      prior.contentHash === binding.contentHash
    if (!unchanged) changed.push(binding.documentId)
    // A physical directory has one binding-root identity: resolve by path first.
    const bindingRootId = bindingRootIdsByRoot.get(binding.rootPath) ?? binding.bindingRootId
    rows.set(binding.documentId, {
      ...(prior ?? {
        id: binding.documentId,
        cloudPresent: false,
        cloudAccountId: null,
        syncStatus: "local-only",
        slug: null,
        status: null,
        artifactType: null,
        visibility: null,
        version: null,
        deletedAt: null,
        createdAt: binding.createdAt,
        excerpt: null,
        excerptContentHash: null,
      }),
      localPresent: true,
      modifiedAt: binding.modifiedAt,
      title: prior && prior.cloudPresent ? (prior.title ?? binding.title) : binding.title,
      bindingRootId,
      relativePath: binding.relativePath,
      canonicalPath: binding.canonicalPath,
      inode: binding.inode,
      contentHash: binding.contentHash,
      size: binding.size,
      lastSeenAt: binding.lastSeenAt,
    } as DesktopCatalogRow)
  }
  for (const id of input.detached) {
    const prior = rows.get(id)
    if (!prior) continue
    if (prior.localPresent) changed.push(id)
    rows.set(id, {
      ...prior,
      localPresent: false,
      bindingRootId: null,
      relativePath: null,
      canonicalPath: null,
      inode: null,
      contentHash: null,
      size: null,
      lastSeenAt: null,
      excerpt: null,
      excerptContentHash: null,
    })
  }
  return { applied: true, changed }
}

/** Espejo de `catalog_list_binding_root_documents`: las filas ligadas a una raíz, por ruta relativa. */
export async function tauriCatalogListBindingRootDocumentsDouble(
  dbPath: string,
  bindingRootId: string,
): Promise<DesktopCatalogRow[]> {
  return [...rowsFor(dbPath).values()]
    .filter((row) => row.bindingRootId === bindingRootId)
    .sort((a, b) => (a.relativePath ?? "").localeCompare(b.relativePath ?? ""))
}

export async function tauriCatalogResolvePathDouble(dbPath: string, path: string): Promise<DesktopCatalogRow | null> {
  await passCatalogReadGates(path)
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

/**
 * Same premise as `tauriCatalogListRetiredBindingRootsDouble`: no test using
 * this double retires a BindingRoot, so there is never a retirement fence to
 * lift and activating one is a real no-op. Registering a Workspace
 * (`DesktopWorkspaceService.registerWorkspace`) calls it before writing
 * Settings.
 */
export async function tauriCatalogActivateBindingRootDouble(): Promise<void> {}

/**
 * Same premise: with no retired BindingRoot there is nothing archived to
 * restore, so re-registering a root returns no cloud-archived candidates.
 */
export async function tauriCatalogReactivateBindingRootDouble(): Promise<DesktopCatalogRow[]> {
  return []
}

/**
 * Same premise, for collections: no test using this double creates a
 * collection (there is no double for `catalog_save_collection`), so the
 * catalog's collection snapshot is really empty. The editor's Properties panel
 * reads it on open (`WritingCollectionsSection` → `loadDesktopCollections`),
 * which is on the path to Export (EXP-05, ODE-601).
 */
export async function tauriCatalogListCollectionSnapshotDouble(_dbPath: string): Promise<DesktopCatalogCollectionSnapshot> {
  return { collections: [], writingCollections: [] }
}

export async function tauriCatalogDetachLocalFileDouble(dbPath: string, id: string): Promise<void> {
  const rows = rowsFor(dbPath)
  const row = rows.get(id)
  if (!row) return
  rows.set(id, { ...row, bindingRootId: null, relativePath: null, canonicalPath: null, inode: null, contentHash: null, size: null, lastSeenAt: null })
}

// ─── sync queue tauri-commands doubles (in-memory `sync_mutations`) ────────
// Espejos de comportamiento (no spies) de los comandos que usa
// `desktopCatalogSyncService`: leen el SQL real de `index.rs` y reproducen su
// semántica, incluidos los efectos sobre `documents.sync_status`. Comparten
// los mismos row stores del catálogo que el resto del archivo, así que una
// prueba puede montar el servicio real, el catálogo real y solo el transporte
// IPC doblado.

/**
 * Espejo de `catalog_enqueue_mutation` (`index.rs:1445-1479`): supersede las
 * mutaciones anteriores del documento, inserta la nueva con
 * `ON CONFLICT(id) DO NOTHING` y marca el documento `pending`.
 */
export async function tauriCatalogEnqueueMutationDouble(
  dbPath: string,
  documentId: string,
  mutation: NonNullable<DesktopCatalogDualWriteInput["mutation"]>,
): Promise<void> {
  const mutations = mutationsFor(dbPath)
  supersedeOlderMutations(mutations, documentId, mutation.id, "superseded by later snapshot mutation")
  if (!mutations.has(mutation.id)) {
    mutations.set(mutation.id, {
      id: mutation.id,
      documentId,
      operation: mutation.operation as SyncMutationRow["operation"],
      payloadJson: mutation.payloadJson,
      status: mutation.status as SyncMutationRow["status"],
      attemptCount: mutation.attemptCount,
      nextRetryAt: mutation.nextRetryAt,
      createdAt: mutation.createdAt,
      lastError: mutation.lastError,
    })
  }
  const rows = rowsFor(dbPath)
  const row = rows.get(documentId)
  if (row) rows.set(documentId, { ...row, syncStatus: "pending" })
}

/**
 * Espejo de `catalog_list_pending_mutations` (`index.rs:1481-1518`):
 * `WHERE (status='pending' OR (?3=1 AND status='failed' AND attempt_count<?4))
 * AND (next_retry_at IS NULL OR next_retry_at<=?1) ORDER BY created_at ASC
 * LIMIT ?2`.
 */
export async function tauriCatalogListPendingMutationsDouble(
  dbPath: string,
  now = Date.now(),
  limit = 200,
  includeFailed = true,
): Promise<DesktopCatalogMutationRow[]> {
  return [...mutationsFor(dbPath).values()]
    .filter(
      (mutation) =>
        (mutation.status === "pending" ||
          (includeFailed && mutation.status === "failed" && mutation.attemptCount < MAX_SYNC_ATTEMPTS)) &&
        (mutation.nextRetryAt === null || mutation.nextRetryAt <= now),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((mutation) => ({
      id: mutation.id,
      documentId: mutation.documentId,
      operation: mutation.operation,
      payloadJson: mutation.payloadJson,
      status: mutation.status as DesktopCatalogMutationRow["status"],
      attemptCount: mutation.attemptCount,
      nextRetryAt: mutation.nextRetryAt,
      createdAt: mutation.createdAt,
      lastError: mutation.lastError,
    }))
}

/**
 * Espejo exacto de `catalog_update_mutation_status` (`index.rs:1409-1443`),
 * incluida su proyección de `documents.sync_status`/`cloud_present`. El CASO
 * no consulta si otra mutación del documento sigue `pending`: reproduce el
 * comportamiento de producción tal cual, que es lo que la prueba de SYNC-05
 * caracteriza (no lo corrige).
 */
export async function tauriCatalogUpdateMutationStatusDouble(
  dbPath: string,
  mutationId: string,
  status: "pending" | "synced" | "failed",
  attemptCount: number,
  nextRetryAt: number | null,
  lastError: string | null,
): Promise<void> {
  const mutations = mutationsFor(dbPath)
  const mutation = mutations.get(mutationId)
  if (mutation) {
    mutation.status = status
    mutation.attemptCount = attemptCount
    mutation.nextRetryAt = nextRetryAt
    mutation.lastError = lastError
  }
  // `WHERE id=(SELECT document_id FROM sync_mutations WHERE id=?1)`: sin fila
  // de mutación no hay documento que actualizar.
  if (!mutation) return
  const rows = rowsFor(dbPath)
  const document = rows.get(mutation.documentId)
  if (!document) return
  const deleteOperation = mutation.operation === "delete"
  const syncStatus =
    status === "failed"
      ? "failed"
      : status === "pending"
        ? "pending"
        : deleteOperation && document.localPresent
          ? "local-only"
          : deleteOperation
            ? "deleted"
            : "synced"
  const cloudPresent =
    status === "synced" ? (deleteOperation ? false : true) : document.cloudPresent
  rows.set(document.id, { ...document, syncStatus, cloudPresent })
}

/**
 * No hay ninguna prueba que encole en `metadata_sync_mutations` (las ediciones
 * de metadata de un writing viajan por `sync_mutations`), así que la cola real
 * está vacía: una cola vacía es la forma real de "nada que hacer", no un atajo.
 */
export async function tauriCatalogListPendingMetadataMutationsDouble(
  _dbPath: string,
  _now = Date.now(),
  _limit = 200,
  _includeFailed = true,
): Promise<DesktopCatalogMetadataMutation[]> {
  return []
}

/** Con la cola de metadata siempre vacía, este UPDATE no encuentra fila y no afecta nada. */
export async function tauriCatalogUpdateMetadataMutationStatusDouble(
  _dbPath: string,
  _mutationId: string,
  _status: "pending" | "synced" | "failed",
  _attemptCount: number,
  _nextRetryAt: number | null,
  _lastError: string | null,
): Promise<void> {}

/** Espejo de `catalog_prune_synced_mutations` (`index.rs:1394-1407`): borra las filas `synced` de las dos colas. */
export async function tauriCatalogPruneSyncedMutationsDouble(dbPath: string): Promise<number> {
  const mutations = mutationsFor(dbPath)
  let removed = 0
  for (const [id, mutation] of [...mutations.entries()]) {
    if (mutation.status === "synced") {
      mutations.delete(id)
      removed += 1
    }
  }
  return removed
}

/** Espejo de `catalog_purge_document` (`index.rs:1372-1387`): `ON DELETE CASCADE` se lleva bindings y mutaciones. */
export async function tauriCatalogPurgeDocumentDouble(dbPath: string, id: string): Promise<void> {
  rowsFor(dbPath).delete(id)
  const mutations = mutationsFor(dbPath)
  for (const [mutationId, mutation] of [...mutations.entries()]) {
    if (mutation.documentId === id) mutations.delete(mutationId)
  }
}

/**
 * Lectura de la cola durable para las aserciones de las pruebas. Devuelve una
 * copia de las filas (mutación de un test jamás altera el estado del doble).
 */
export function catalogMutationsDouble(dbPath: string): ReadonlyArray<SyncMutationRow> {
  return [...mutationsFor(dbPath).values()].map((mutation) => ({ ...mutation }))
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
