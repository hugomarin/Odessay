/**
 * Catalog seam recorder — ODE-613 (vía a).
 *
 * Records, from the REAL TS side, the exact sequence of Tauri `invoke` calls a
 * desktop flow produces, so `src-tauri/tests/catalog_seam.rs` can replay that
 * same sequence against the real Rust commands and SQLite. The sequence is
 * never written twice:
 *
 *   production wrapper (SqliteDocumentCatalog / tauri-commands)
 *     + real reconciler (createWorkspaceReconciler, wired exactly like
 *       desktop-workspace-reconciler.ts: workspace_sync → listByBindingRoot →
 *       applyReconcileTransaction)
 *     → mocked `@tauri-apps/api/core` invoke that RECORDS {cmd, args} and
 *       answers with the per-command semantics of the Rust layer
 *     → tests/fixtures/catalog-seam/catalog-seam-v3.json
 *
 * Only the IPC boundary is doubled (external boundary, capability-proof
 * contract rule 3). The double's responses are NOT throwaway: they decide what
 * the TS side does next (which ids it re-sends, which upserts it commits). So
 * every recorded invoke also stores a projection of the response — the fields
 * that determine identity and presence — and the Rust replay asserts the REAL
 * command's response matches that projection step by step, on top of the
 * canonical outcome (SQLite rows vs. files on disk). See
 * `projectInvokeResponse` for the exact fields and the one documented
 * exclusion (`folderCount`, which no consumer of this sequence reads).
 *
 * Paths are placeholders ($DB, $ROOT_A, $ROOT_B) so the fixture is machine
 * independent; the Rust runner rewrites them to its own temp dirs.
 */

import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { computeMarkdownContentHash } from "@/lib/content-hash"
import {
  tauriWorkspaceSync,
  type DesktopCatalogRow,
  type DesktopWorkspaceSnapshot,
} from "@/lib/services/desktop/tauri-commands"
import {
  createWorkspaceReconciler,
  type KnownBinding,
  type ObservedFile,
  type ReconcilerRoot,
  type UnboundFile,
  type WorkspaceReconciler,
} from "@/lib/services/desktop/workspace-reconciler"

export const CATALOG_SEAM_FIXTURE_VERSION = 3 as const
export const FIXTURE_DB_PATH = "$DB"
export const FIXTURE_ROOT_PATHS = { rootA: "$ROOT_A", rootB: "$ROOT_B" } as const
// Synthetic volume for every fixture file, like the synthetic inode: the
// double cannot know the replay machine's `st_dev`, so the projection excludes
// it and the recording only needs one shared volume (ODE-657 review P1).
const FIXTURE_DEVICE = 1
export type FixtureRootKey = keyof typeof FIXTURE_ROOT_PATHS

/** The read fields that determine identity/presence/content for SYS-01/SYS-05/WATCH-07. */
export type CatalogSeamRowProjection = {
  id: string
  relativePath: string | null
  localPresent: boolean
  bindingRootId: string | null
  contentHash: string | null
}

export type CatalogSeamInvokeResponse =
  | {
      files: { relativePath: string; id: string; contentHash: string }[]
      unboundPaths: string[]
      unboundFiles: { relativePath: string; contentHash: string; size: number }[]
    }
  | { applied: boolean; changed: string[] }
  | CatalogSeamRowProjection
  | CatalogSeamRowProjection[]
  | null

export type CatalogSeamFixtureStep =
  | { kind: "fs"; op: "seed-manifest"; root: FixtureRootKey; bindingRootId: string }
  | {
      kind: "fs"
      op: "write"
      root: FixtureRootKey
      relativePath: string
      content: string
      inode: number
      modifiedAt: number
    }
  | { kind: "fs"; op: "rename"; root: FixtureRootKey; relativePath: string; newRelativePath: string }
  | { kind: "fs"; op: "delete"; root: FixtureRootKey; relativePath: string }
  | {
      kind: "invoke"
      cmd: string
      args: Record<string, unknown>
      response: CatalogSeamInvokeResponse
    }

export type CatalogSeamScenario = {
  name: string
  description: string
  steps: CatalogSeamFixtureStep[]
}

export type CatalogSeamFixture = {
  version: typeof CATALOG_SEAM_FIXTURE_VERSION
  generator: string
  scenarios: CatalogSeamScenario[]
}

export function serializeCatalogSeamFixture(fixture: CatalogSeamFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`
}

// ─── The invoke double: per-command semantics ────────────────────────────────

type ModelFile = { content: string; inode: number; modifiedAt: number }
type ModelEntry = { id: string; inode: number; contentHash: string; lastSeen: number; size: number }
type ModelDocument = { id: string; localPresent: boolean; title: string; createdAt: number; modifiedAt: number }
type ModelBinding = {
  documentId: string
  bindingRootId: string
  rootPath: string
  relativePath: string
  canonicalPath: string
  inode: number
  contentHash: string
  size: number
  lastSeenAt: number
}

type ModelRoot = {
  key: FixtureRootKey
  rootPath: string
  bindingRootId: string
  files: Map<string, ModelFile>
  manifest: Map<string, ModelEntry>
}

type ReconcileUpsert = {
  bindingRootId: string
  rootPath: string
  documentId: string
  relativePath: string
  canonicalPath: string
  inode: number | null
  contentHash: string | null
  size: number | null
  lastSeenAt: number | null
  title: string
  createdAt: number | null
  modifiedAt: number | null
}

function normalizeFixtureJson(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(normalizeFixtureJson)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeFixtureJson(entry)]),
    )
  }
  return value
}

function byRelativePath<T extends { relativePath: string }>(left: T, right: T): number {
  return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
}

/** Mirrors the adapter's mapping from a `workspace_sync` snapshot to observed files. */
function observedFilesFromSnapshot(snapshot: DesktopWorkspaceSnapshot): ObservedFile[] {
  return snapshot.files.map((file) => ({
    relativePath: file.relativePath,
    canonicalPath: file.path,
    inode: file.inode || null,
    device: file.device ?? null,
    contentHash: file.contentHash || null,
    size: file.size,
    modifiedAt: file.modifiedAt,
    manifestId: file.id || null,
  }))
}

function projectCatalogRow(row: DesktopCatalogRow): CatalogSeamRowProjection {
  return {
    id: row.id,
    relativePath: row.relativePath,
    localPresent: row.localPresent,
    bindingRootId: row.bindingRootId,
    contentHash: row.contentHash,
  }
}

function projectCatalogRowOrNull(row: DesktopCatalogRow | null): CatalogSeamRowProjection | null {
  return row ? projectCatalogRow(row) : null
}

/**
 * The response projection the Rust replay must reproduce exactly. It keeps only
 * the fields that determine identity, presence, and content along the recorded
 * sequence (P2-1, ODE-613 review; ODE-637): the id/path mapping and
 * unboundPaths of `workspace_sync` decide which document ids the TS wrapper
 * re-sends and which it mints; contentHash proves edits flow through the hash
 * projections; `changed` and read rows are what subscribers consume.
 *
 * `folderCount` is deliberately excluded. No consumer of this sequence reads
 * it, and the double counts the folders of the bound manifest while Rust counts
 * the scanned scope — they diverge exactly on passes that still have unbound
 * paths, with no SYS-01/SYS-05/WATCH-07 signal. Including it would only encode
 * double-only semantics into the recording.
 */
export function projectInvokeResponse(cmd: string, response: unknown): CatalogSeamInvokeResponse {
  switch (cmd) {
    case "workspace_sync": {
      const snapshot = response as {
        files: { relativePath: string; id: string; contentHash: string }[]
        unboundPaths: string[]
        unboundFiles?: { relativePath: string; contentHash: string; size: number }[]
      }
      return {
        files: snapshot.files
          .map((file) => ({
            relativePath: file.relativePath,
            id: file.id,
            contentHash: file.contentHash,
          }))
          .sort(byRelativePath),
        unboundPaths: [...snapshot.unboundPaths].sort(),
        // Inode is deliberately excluded: it is synthetic in the double and
        // real in the replay, so it can never be compared across the seam. The
        // identity signal the wrapper reads is path + hash + size (ODE-657).
        unboundFiles: [...(snapshot.unboundFiles ?? [])]
          .map((file) => ({
            relativePath: file.relativePath,
            contentHash: file.contentHash,
            size: file.size,
          }))
          .sort(byRelativePath),
      }
    }
    case "catalog_apply_reconcile": {
      const result = response as { applied: boolean; changed: string[] }
      return { applied: result.applied, changed: [...result.changed] }
    }
    case "catalog_list_binding_root_documents":
      return (response as DesktopCatalogRow[]).map(projectCatalogRow)
    default:
      // The remaining commands are reads: catalog_get_by_id / catalog_resolve_path.
      return projectCatalogRowOrNull(response as DesktopCatalogRow | null)
  }
}

/**
 * Records one scenario session. Everything the scenario does goes through
 * `session` helpers, so the fixture only ever contains calls the real TS code
 * emitted plus the fs setup steps the Rust runner must materialize.
 */
export class CatalogSeamSession {
  readonly steps: CatalogSeamFixtureStep[] = []
  private readonly roots = new Map<FixtureRootKey, ModelRoot>()
  private readonly documents = new Map<string, ModelDocument>()
  private readonly bindings = new Map<string, ModelBinding>()

  constructor(
    readonly name: string,
    readonly description: string,
  ) {}

  defineRoot(key: FixtureRootKey, bindingRootId: string): ReconcilerRoot {
    const rootPath = FIXTURE_ROOT_PATHS[key]
    this.roots.set(key, {
      key,
      rootPath,
      bindingRootId,
      files: new Map(),
      manifest: new Map(),
    })
    this.steps.push({ kind: "fs", op: "seed-manifest", root: key, bindingRootId })
    return { id: bindingRootId, rootPath, kind: "managed", visibleAsWorkspace: true, selectedPaths: [] }
  }

  private requireRoot(key: FixtureRootKey): ModelRoot {
    const root = this.roots.get(key)
    if (!root) throw new Error(`catalog-seam recorder: root ${key} was not defined`)
    return root
  }

  fsWrite(
    key: FixtureRootKey,
    relativePath: string,
    content: string,
    options: { inode: number; modifiedAt: number },
  ): void {
    this.requireRoot(key).files.set(relativePath, { ...options, content })
    this.steps.push({
      kind: "fs",
      op: "write",
      root: key,
      relativePath,
      content,
      inode: options.inode,
      modifiedAt: options.modifiedAt,
    })
  }

  fsRename(key: FixtureRootKey, relativePath: string, newRelativePath: string): void {
    const root = this.requireRoot(key)
    const file = root.files.get(relativePath)
    if (!file) throw new Error(`catalog-seam recorder: no file ${relativePath} to rename`)
    root.files.delete(relativePath)
    root.files.set(newRelativePath, { ...file, modifiedAt: file.modifiedAt + 1 })
    this.steps.push({ kind: "fs", op: "rename", root: key, relativePath, newRelativePath })
  }

  fsDelete(key: FixtureRootKey, relativePath: string): void {
    this.requireRoot(key).files.delete(relativePath)
    this.steps.push({ kind: "fs", op: "delete", root: key, relativePath })
  }

  /** The real wrapper the app calls; its invokes are recorded. */
  createCatalog(): SqliteDocumentCatalog {
    return new SqliteDocumentCatalog(FIXTURE_DB_PATH)
  }

  /**
   * The production reconciler wiring (mirror of desktop-workspace-reconciler):
   * scan = workspace_sync + listByBindingRoot; commit = applyReconcileTransaction.
   * loadRoots is in-memory here — settings/DirectoryScope is an organizational
   * projection with no catalog semantics, deliberately out of the seam.
   */
  createReconciler(catalog: SqliteDocumentCatalog): WorkspaceReconciler {
    return createWorkspaceReconciler({
      loadRoots: async () => [...this.roots.values()].map((root) => ({
        id: root.bindingRootId,
        rootPath: root.rootPath,
        kind: "managed" as const,
        visibleAsWorkspace: true,
        selectedPaths: [],
      })),
      scanRoot: async (root) => {
        const snapshot = await tauriWorkspaceSync(root.rootPath, undefined, undefined, {
          mintUnbound: false,
        })
        const observed = observedFilesFromSnapshot(snapshot)
        const unbound: UnboundFile[] = (snapshot.unboundFiles ?? []).map((file) => ({
          relativePath: file.relativePath,
          inode: file.inode || null,
          device: file.device ?? null,
          contentHash: file.contentHash || null,
          size: file.size,
          modifiedAt: file.modifiedAt,
        }))
        const rows = await catalog.listByBindingRoot(root.id)
        const knownBindings: KnownBinding[] = rows
          .filter((row) => row.binding?.bindingRootId === root.id)
          .map((row) => ({
            documentId: row.id,
            bindingRootId: root.id,
            relativePath: row.binding!.relativePath,
            inode: row.binding!.inode,
            contentHash: row.binding!.contentHash,
          }))
        return { observed, unbound, knownBindings }
      },
      bindUnbound: async (root, ids) => {
        const snapshot = await tauriWorkspaceSync(root.rootPath, undefined, ids)
        return observedFilesFromSnapshot(snapshot)
      },
      commit: async (commit) => {
        await catalog.applyReconcileTransaction(commit)
      },
    })
  }

  /** Reads the id the wrapper minted for a bound path (for production reads). */
  documentIdForPath(rootKey: FixtureRootKey, relativePath: string): string {
    const canonicalPath = `${FIXTURE_ROOT_PATHS[rootKey]}/${relativePath}`
    for (const binding of this.bindings.values()) {
      if (binding.canonicalPath === canonicalPath) return binding.documentId
    }
    throw new Error(`catalog-seam recorder: no document bound at ${canonicalPath}`)
  }

  /** True when the model still holds a binding at that canonical path. */
  hasBindingAtPath(rootKey: FixtureRootKey, relativePath: string): boolean {
    const canonicalPath = `${FIXTURE_ROOT_PATHS[rootKey]}/${relativePath}`
    for (const binding of this.bindings.values()) {
      if (binding.canonicalPath === canonicalPath) return true
    }
    return false
  }

  toScenario(): CatalogSeamScenario {
    return { name: this.name, description: this.description, steps: this.steps }
  }

  // ── command semantics (the doubled IPC boundary) ──────────────────────────

  async invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.dispatch(cmd, args)
    this.steps.push({
      kind: "invoke",
      cmd,
      args: normalizeFixtureJson(args) as Record<string, unknown>,
      response: projectInvokeResponse(cmd, response),
    })
    return response
  }

  private async dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
      case "workspace_sync":
        return this.workspaceSync(args)
      case "catalog_list_binding_root_documents":
        return this.listBindingRootDocuments(args)
      case "catalog_get_by_id":
        return this.getById(args)
      case "catalog_resolve_path":
        return this.resolvePath(args)
      case "catalog_apply_reconcile":
        return this.applyReconcile(args)
      default:
        throw new Error(
          `catalog-seam recorder: unhandled command "${cmd}" — a production call shape changed; ` +
            "extend the double with its semantics or fix the wrapper",
        )
    }
  }

  private async workspaceSync(args: Record<string, unknown>): Promise<unknown> {
    const rootPath = String(args.rootPath)
    const root = [...this.roots.values()].find((entry) => entry.rootPath === rootPath)
    if (!root) throw new Error(`catalog-seam recorder: workspace_sync for unknown root ${rootPath}`)

    const requested = args.selectedPaths as string[] | null
    if (requested !== null && requested !== undefined) {
      throw new Error("catalog-seam recorder: scenarios only exercise whole-root scopes")
    }
    const documentIds = (args.documentIds ?? null) as Record<string, string> | null

    const entryByInode = new Map<number, ModelEntry>()
    const hashCounts = new Map<string, number>()
    const entryByHash = new Map<string, ModelEntry>()
    for (const [path, entry] of root.manifest) {
      if (entry.inode > 0) entryByInode.set(entry.inode, entry)
      hashCounts.set(entry.contentHash, (hashCounts.get(entry.contentHash) ?? 0) + 1)
      entryByHash.set(entry.contentHash, entry)
    }

    const files: {
      id: string
      path: string
      relativePath: string
      name: string
      modifiedAt: number
      size: number
      inode: number
      device: number
      contentHash: string
    }[] = []
    const unboundPaths: string[] = []
    const unboundFiles: {
      relativePath: string
      inode: number
      device: number
      contentHash: string
      size: number
      modifiedAt: number
    }[] = []
    const nextManifest = new Map<string, ModelEntry>()

    const observedPaths = [...root.files.keys()].sort((left, right) => left.localeCompare(right))
    for (const relativePath of observedPaths) {
      const file = root.files.get(relativePath)!
      const contentHash = await computeMarkdownContentHash(file.content)
      const existing =
        root.manifest.get(relativePath) ??
        entryByInode.get(file.inode) ??
        (hashCounts.get(contentHash) === 1 ? entryByHash.get(contentHash) : undefined)
      const id = existing?.id ?? documentIds?.[relativePath]
      if (!id) {
        unboundPaths.push(relativePath)
        unboundFiles.push({
          relativePath,
          inode: file.inode,
          device: FIXTURE_DEVICE,
          contentHash,
          size: Buffer.byteLength(file.content),
          modifiedAt: file.modifiedAt,
        })
        continue
      }
      const entry: ModelEntry = {
        id,
        inode: file.inode,
        contentHash,
        lastSeen: file.modifiedAt,
        size: Buffer.byteLength(file.content),
      }
      nextManifest.set(relativePath, entry)
      files.push({
        id,
        path: `${rootPath}/${relativePath}`,
        relativePath,
        name: relativePath.split("/").pop()!,
        modifiedAt: file.modifiedAt,
        size: entry.size,
        inode: file.inode,
        device: FIXTURE_DEVICE,
        contentHash,
      })
    }

    // Rust rebuilds the manifest from the bound files only: an unobserved (or
    // still unbound) path drops out of the durable ledger on this write.
    root.manifest = nextManifest
    files.sort((left, right) => right.modifiedAt - left.modifiedAt)

    return {
      rootPath,
      bindingRootId: root.bindingRootId,
      name: rootPath.split("/").pop() ?? "root",
      fileCount: files.length,
      folderCount: countFolders([...nextManifest.keys()]),
      updatedAt: files[0]?.modifiedAt ?? null,
      selectedPaths: [],
      files,
      unboundPaths,
      unboundFiles,
    }
  }

  private listBindingRootDocuments(args: Record<string, unknown>): DesktopCatalogRow[] {
    const bindingRootId = String(args.bindingRootId)
    return [...this.bindings.values()]
      .filter((binding) => binding.bindingRootId === bindingRootId)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((binding) => this.rowFor(binding.documentId))
      .filter((row): row is DesktopCatalogRow => row !== null)
  }

  private getById(args: Record<string, unknown>): DesktopCatalogRow | null {
    return this.rowFor(String(args.id))
  }

  private resolvePath(args: Record<string, unknown>): DesktopCatalogRow | null {
    const canonicalPath = String(args.path)
    for (const binding of this.bindings.values()) {
      if (binding.canonicalPath === canonicalPath) return this.rowFor(binding.documentId)
    }
    return null
  }

  private applyReconcile(args: Record<string, unknown>): { applied: boolean; changed: string[] } {
    const input = args.input as { upserts: ReconcileUpsert[]; detached: string[] }
    const changed: string[] = []

    for (const upsert of input.upserts) {
      const previous = this.bindings.get(upsert.documentId)
      const unchanged =
        previous !== undefined &&
        previous.relativePath === upsert.relativePath &&
        previous.canonicalPath === upsert.canonicalPath &&
        previous.inode === upsert.inode &&
        previous.contentHash === upsert.contentHash
      if (!unchanged) changed.push(upsert.documentId)

      const existingDocument = this.documents.get(upsert.documentId)
      if (existingDocument) {
        existingDocument.localPresent = true
        existingDocument.modifiedAt = upsert.modifiedAt ?? existingDocument.modifiedAt
      } else {
        this.documents.set(upsert.documentId, {
          id: upsert.documentId,
          localPresent: true,
          title: upsert.title,
          createdAt: upsert.createdAt ?? 0,
          modifiedAt: upsert.modifiedAt ?? 0,
        })
      }
      this.bindings.set(upsert.documentId, {
        documentId: upsert.documentId,
        bindingRootId: upsert.bindingRootId,
        rootPath: upsert.rootPath,
        relativePath: upsert.relativePath,
        canonicalPath: upsert.canonicalPath,
        inode: upsert.inode ?? 0,
        contentHash: upsert.contentHash ?? "",
        size: upsert.size ?? 0,
        lastSeenAt: upsert.lastSeenAt ?? 0,
      })
    }

    for (const id of input.detached) {
      const document = this.documents.get(id)
      if (document?.localPresent) changed.push(id)
      this.bindings.delete(id)
      if (document) document.localPresent = false
    }

    return { applied: true, changed }
  }

  private rowFor(id: string): DesktopCatalogRow | null {
    const document = this.documents.get(id)
    if (!document) return null
    const binding = this.bindings.get(id)
    return {
      id: document.id,
      localPresent: document.localPresent,
      cloudPresent: false,
      cloudAccountId: null,
      syncStatus: "local-only",
      title: document.title,
      slug: null,
      status: null,
      artifactType: null,
      visibility: null,
      version: null,
      deletedAt: null,
      createdAt: document.createdAt,
      modifiedAt: document.modifiedAt,
      bindingRootId: binding?.bindingRootId ?? null,
      relativePath: binding?.relativePath ?? null,
      canonicalPath: binding?.canonicalPath ?? null,
      inode: binding?.inode ?? null,
      contentHash: binding?.contentHash ?? null,
      size: binding?.size ?? null,
      lastSeenAt: binding?.lastSeenAt ?? null,
      excerpt: null,
      excerptContentHash: null,
    }
  }
}

function countFolders(relativePaths: string[]): number {
  const folders = new Set<string>()
  for (const path of relativePaths) {
    const segments = path.split("/")
    segments.pop()
    let current = ""
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      folders.add(current)
    }
  }
  return folders.size
}

// ─── Fixture generation ──────────────────────────────────────────────────────

let activeSession: CatalogSeamSession | null = null
let uuidCounter = 0

/** Installed as the mocked `invoke` of `@tauri-apps/api/core`. */
export async function catalogSeamInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (!activeSession) {
    throw new Error("catalog-seam recorder: invoke called with no active recording session")
  }
  return activeSession.invoke(cmd, args)
}

async function recordScenario(
  name: string,
  description: string,
  build: (session: CatalogSeamSession) => Promise<void>,
): Promise<CatalogSeamScenario> {
  const session = new CatalogSeamSession(name, description)
  activeSession = session
  uuidCounter = 0
  const originalRandomUuid = globalThis.crypto.randomUUID
  const randomUuidStub = () => {
    uuidCounter += 1
    return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, "0")}`
  }
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: randomUuidStub,
      configurable: true,
      writable: true,
    })
    await build(session)
    return session.toScenario()
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: originalRandomUuid,
      configurable: true,
      writable: true,
    })
    activeSession = null
  }
}

const LETTER_V1 = "# Letter\n\nversion one\n"
const LETTER_V2 = "# Letter\n\nversion two — renamed on disk\n"
const NEIGHBOUR = "# Neighbour\n\ncreated outside the app\n"
const WATCH07_EXTERNAL_V1 = "# External edit\n\noriginal content\n"
const WATCH07_EXTERNAL_V2 = "# External edit\n\nchanged outside the app\n"
const WATCH04_KEEPER = "# Keeper\n\nresident in root A\n"

async function buildSys01RegisterMoveReopen(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/letter.md", LETTER_V1, { inode: 101, modifiedAt: 1_700_000_001_000 })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()
  const documentId = session.documentIdForPath("rootA", "notes/letter.md")
  await catalog.getById(documentId)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/notes/letter.md`)

  // Renamed outside the app: identity must survive the path change through the
  // reconcile path (inode correlation in workspace_sync + known bindings).
  session.fsRename("rootA", "notes/letter.md", "archive/letter-final.md")
  await reconciler.rescanAll()
  await catalog.getById(documentId)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/archive/letter-final.md`)

  // Restart the catalog: every command reopens the DB (open_db per command) and
  // a fresh reconciler instance rescans the root.
  reconciler.dispose()
  const restarted = session.createReconciler(catalog)
  await restarted.start()
  restarted.dispose()

  await catalog.getById(documentId)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/archive/letter-final.md`)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/notes/letter.md`)
}

async function buildSys01Homonyms(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.defineRoot("rootB", "fixture-root-b")
  session.fsWrite("rootA", "letter.md", LETTER_V1, { inode: 201, modifiedAt: 1_700_000_002_000 })
  session.fsWrite("rootB", "letter.md", LETTER_V2, { inode: 301, modifiedAt: 1_700_000_003_000 })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()
  const documentA = session.documentIdForPath("rootA", "letter.md")
  const documentB = session.documentIdForPath("rootB", "letter.md")
  await catalog.getById(documentA)
  await catalog.getById(documentB)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/letter.md`)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootB}/letter.md`)

  // A second pass over both roots must keep the two homonyms apart.
  await reconciler.rescanAll()
  reconciler.dispose()
}

async function buildSys05ReconcileTracksDisk(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/a.md", LETTER_V1, { inode: 401, modifiedAt: 1_700_000_004_000 })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()

  // Created outside the app.
  session.fsWrite("rootA", "notes/b.md", NEIGHBOUR, { inode: 402, modifiedAt: 1_700_000_005_000 })
  await reconciler.rescanAll()

  // Moved outside the app.
  session.fsRename("rootA", "notes/a.md", "notes/a-moved.md")
  await reconciler.rescanAll()

  // Deleted outside the app.
  session.fsDelete("rootA", "notes/b.md")
  await reconciler.rescanAll()
  reconciler.dispose()

  const documentA = session.documentIdForPath("rootA", "notes/a-moved.md")
  await catalog.getById(documentA)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/notes/a-moved.md`)
}

async function buildWatch07ExternalEditSamePath(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/watched.md", WATCH07_EXTERNAL_V1, {
    inode: 501,
    modifiedAt: 1_700_000_006_000,
  })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()

  const documentId = session.documentIdForPath("rootA", "notes/watched.md")
  const beforeEdit = await catalog.getById(documentId)
  if (beforeEdit?.binding?.contentHash !== await computeMarkdownContentHash(WATCH07_EXTERNAL_V1)) {
    throw new Error("catalog-seam recorder: initial WATCH-07 hash does not match the file")
  }

  // An external editor changes bytes in place: the path and inode stay stable.
  session.fsWrite("rootA", "notes/watched.md", WATCH07_EXTERNAL_V2, {
    inode: 501,
    modifiedAt: 1_700_000_007_000,
  })
  await reconciler.rescanAll()

  const afterEdit = await catalog.getById(documentId)
  if (afterEdit?.binding?.contentHash !== await computeMarkdownContentHash(WATCH07_EXTERNAL_V2)) {
    throw new Error("catalog-seam recorder: reconciled WATCH-07 hash does not match the external edit")
  }
  reconciler.dispose()
}

async function buildWatch04ExternalMoveAcrossRoots(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.defineRoot("rootB", "fixture-root-b")
  session.fsWrite("rootA", "notes/letter.md", LETTER_V1, {
    inode: 601,
    modifiedAt: 1_700_000_008_000,
  })
  // A resident sibling keeps root A's volume knowable after the move: the
  // correlation only trusts an inode match when both roots report the same
  // device, and a root with no file evidence is "volume unknown" (ODE-657
  // review P1). It also proves the move does not disturb the files it leaves.
  session.fsWrite("rootA", "notes/keeper.md", WATCH04_KEEPER, {
    inode: 602,
    modifiedAt: 1_700_000_007_500,
  })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()
  const documentId = session.documentIdForPath("rootA", "notes/letter.md")
  const keeperId = session.documentIdForPath("rootA", "notes/keeper.md")

  // Moved outside the app from root A to root B: the origin disappears in the
  // same pass the destination appears unbound. Identity must survive through
  // device + inode + content_hash correlation across roots, not a fresh UUID.
  session.fsDelete("rootA", "notes/letter.md")
  session.fsWrite("rootB", "notes/letter.md", LETTER_V1, {
    inode: 601,
    modifiedAt: 1_700_000_009_000,
  })
  await reconciler.rescanAll()
  reconciler.dispose()

  const movedId = session.documentIdForPath("rootB", "notes/letter.md")
  if (movedId !== documentId) {
    throw new Error(
      `catalog-seam recorder: cross-root move minted ${movedId} instead of ${documentId}`,
    )
  }
  if (session.hasBindingAtPath("rootA", "notes/letter.md")) {
    throw new Error("catalog-seam recorder: the moved document kept a stale binding in root A")
  }
  if (session.documentIdForPath("rootA", "notes/keeper.md") !== keeperId) {
    throw new Error("catalog-seam recorder: the resident sibling lost its identity in the move")
  }
  const row = await catalog.getById(documentId)
  if (row?.binding?.bindingRootId !== "fixture-root-b" || row.localPresent !== true) {
    throw new Error("catalog-seam recorder: the moved document is not bound to root B")
  }
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootB}/notes/letter.md`)
}

export async function buildCatalogSeamFixture(): Promise<CatalogSeamFixture> {
  const scenarios = [
    await recordScenario(
      "sys01-homonyms-distinct-roots",
      "SYS-01: two documents with the same name in two BindingRoots never collide — each canonical " +
        "path resolves to its own UUID and each UUID keeps its own binding across a rescan.",
      buildSys01Homonyms,
    ),
    await recordScenario(
      "sys01-register-move-reopen",
      "SYS-01: reconcile registers notes/letter.md, the file is renamed on disk and reconciled " +
        "(same UUID via inode correlation), the catalog is reopened and the UUID still resolves " +
        "to the moved path; the old path resolves to nothing.",
      buildSys01RegisterMoveReopen,
    ),
    await recordScenario(
      "sys05-reconcile-tracks-disk",
      "SYS-05: after an external create, move and delete each followed by a reconcile, the catalog " +
        "matches the durable disk state: the moved file keeps its UUID at the new path, the created " +
        "file got its own row and the deleted file is detached (local_present=false, no binding).",
      buildSys05ReconcileTracksDisk,
    ),
    await recordScenario(
      "watch07-external-edit-same-path",
      "WATCH-07: an external edit changes markdown at the same path and inode; after rescan, getById " +
        "returns the updated BLAKE3 content hash for the same document identity.",
      buildWatch07ExternalEditSamePath,
    ),
    await recordScenario(
      "watch04-external-move-across-roots",
      "WATCH-04: a file moved outside the app from root A to root B keeps its UUID — the " +
        "destination scan reports it unbound with inode + content hash, the pass correlates it " +
        "against A's confirmed detach, and the binding moves to B with no detach in A.",
      buildWatch04ExternalMoveAcrossRoots,
    ),
  ]
  return {
    version: CATALOG_SEAM_FIXTURE_VERSION,
    generator: "tests/support/catalog-seam-recorder.ts",
    scenarios,
  }
}
