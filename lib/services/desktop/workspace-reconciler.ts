/**
 * WorkspaceReconciler — ODE-370 (Fase 9 M2)
 *
 * The global reconciliation pipeline that turns filesystem evidence into stable
 * document identity and projects every observed BindingRoot into the desktop
 * SQLite catalog.
 *
 * Architecture Contract (odessay-desktop-document-catalog.md §WorkspaceReconciler):
 *  - Layer: Application. The watcher (adapter) only detects evidence; this module
 *    decides identity and writes stores. The `.odessay/index.json` manifest never
 *    listens by itself.
 *  - Runtime scope: desktop + shared-core contracts. This file is pure/injectable
 *    so it can be unit-tested without Tauri; the orchestrator wires timers,
 *    scanning and the catalog through injected dependencies.
 *  - Invariants preserved here:
 *      · the watcher never chooses cloud identity or a delete;
 *      · a file only loses `local_present` on *confirmed* physical absence — an
 *        out-of-scope path or an unobservable mount never detaches anything;
 *      · identity is exhausted (path → inode/move → local hash → cloud hash →
 *        ambiguous) before minting a new UUID;
 *      · a burst of events collapses to one logical transaction / CatalogChange.
 *
 * The pure resolver (`reconcileRoot`) is deterministic. Manifest-atomic writes and
 * "manifest persists before SQLite is confirmed" ordering live in the desktop
 * adapter (workspace.rs manifest v2 + the injected `commit`), not here.
 */

export type BindingRootKind = "managed" | "external"

export type ReconcilerRoot = {
  /** Durable bindingRootId shared with manifest v2 and the SQLite catalog. */
  id: string
  rootPath: string
  kind: BindingRootKind
  visibleAsWorkspace: boolean
  /** Empty = whole root observed. Non-empty = watcher/scan limited to these paths. */
  selectedPaths: string[]
}

/** A markdown file observed on disk during a root scan. */
export type ObservedFile = {
  relativePath: string
  canonicalPath: string
  inode: number | null
  contentHash: string | null
  size: number | null
  modifiedAt: number | null
  /**
   * Durable UUID already recorded for this path in the v2 manifest ledger.
   * `.odessay/index.json` is the binding authority (invariant #4), so when it
   * is present it is preferred over every heuristic below. Absent for a truly
   * unbound file that the manifest has not yet bound.
   */
  manifestId?: string | null
}

/** A prior binding known from the manifest / catalog for one root. */
export type KnownBinding = {
  documentId: string
  bindingRootId: string
  relativePath: string
  inode: number | null
  contentHash: string | null
}

export type ResolutionStrategy =
  | "path"
  | "inode"
  | "local_hash"
  | "cloud_hash"
  | "minted"
  | "ambiguous"

export type ResolvedBinding = {
  /** null only when `strategy === "ambiguous"`: identity is never auto-chosen. */
  documentId: string | null
  bindingRootId: string
  relativePath: string
  canonicalPath: string
  inode: number | null
  contentHash: string | null
  size: number | null
  modifiedAt: number | null
  strategy: ResolutionStrategy
  /** Candidate documentIds when the resolution is ambiguous. */
  candidates?: string[]
}

/**
 * Resolves a unique cloud UUID for a content hash. Returns the id when exactly one
 * cloud record matches, `"ambiguous"` when several do, or `null` when none do.
 * Cloud enrichment must never block local readiness, so this is optional.
 */
export type CloudHashLookup = (contentHash: string) => string | "ambiguous" | null

export type ReconcileRootInput = {
  root: ReconcilerRoot
  /**
   * Files observed in the root, or `null` when the root could not be scanned
   * (permission loss, unmounted volume, watcher not started). `null` means
   * "temporarily unobservable" — nothing is detached.
   */
  observed: ObservedFile[] | null
  knownBindings: KnownBinding[]
  cloudHashLookup?: CloudHashLookup
  mintId?: () => string
  transactionId?: string
}

export type ReconcileRootResult = {
  transactionId: string
  bindingRootId: string
  /** One entry per observed file. */
  resolved: ResolvedBinding[]
  /** documentIds confirmed physically absent → set local_present=false. */
  detached: string[]
  /** documentIds skipped because their path is out of current scope — kept. */
  outOfScope: string[]
  /** Subset of `resolved` whose identity is ambiguous (no auto-choice). */
  ambiguous: ResolvedBinding[]
  /** True when the root was unobservable: no store changes were derived. */
  unobservable: boolean
}

const DEFAULT_MINT = () => globalThis.crypto.randomUUID()

/**
 * TS mirror of the Rust `matches_selected_paths`: empty scope matches everything;
 * otherwise a relative path must equal a selected path or live under it.
 */
export function matchesSelectedPaths(
  relativePath: string,
  selectedPaths: string[],
): boolean {
  if (selectedPaths.length === 0) return true
  return selectedPaths.some(
    (selected) =>
      relativePath === selected || relativePath.startsWith(`${selected}/`),
  )
}

/**
 * Pure reconciliation for a single BindingRoot. Deterministic given its inputs.
 *
 * Priority (spec §Prioridad de reconciliación):
 *   1. same relative path in the same root
 *   2. same inode in the root, or a correlated move (inode of a now-absent path)
 *   3. unique content_hash among known local bindings
 *   4. unique content_hash in the cloud
 *   5. several matches → ambiguous, never auto-chosen
 *   6. no match → mint a new UUID
 *
 * An atomic save keeps its UUID through rule 1 (path) even when inode and hash
 * both change, because the path match is tried first.
 */
export function reconcileRoot(input: ReconcileRootInput): ReconcileRootResult {
  const { root, observed, knownBindings } = input
  const mintId = input.mintId ?? DEFAULT_MINT
  const cloudHashLookup = input.cloudHashLookup
  const transactionId = input.transactionId ?? DEFAULT_MINT()

  // A root we could not scan is "temporarily unobservable": never treat missing
  // evidence as a delete. The existing catalog stays as-is (rendered stale).
  if (observed === null) {
    return {
      transactionId,
      bindingRootId: root.id,
      resolved: [],
      detached: [],
      outOfScope: [],
      ambiguous: [],
      unobservable: true,
    }
  }

  const byPath = new Map<string, KnownBinding>()
  const byInode = new Map<number, KnownBinding>()
  const byHash = new Map<string, KnownBinding[]>()

  for (const binding of knownBindings) {
    byPath.set(binding.relativePath, binding)
    if (typeof binding.inode === "number" && binding.inode > 0) {
      byInode.set(binding.inode, binding)
    }
    if (binding.contentHash) {
      const bucket = byHash.get(binding.contentHash)
      if (bucket) bucket.push(binding)
      else byHash.set(binding.contentHash, [binding])
    }
  }

  const consumed = new Set<string>()
  const resolved: ResolvedBinding[] = []

  for (const file of observed) {
    const resolvedBinding = resolveFile(file, root.id, {
      byPath,
      byInode,
      byHash,
      consumed,
      cloudHashLookup,
      mintId,
    })
    if (resolvedBinding.documentId) consumed.add(resolvedBinding.documentId)
    resolved.push(resolvedBinding)
  }

  // Any prior binding not reused by an observed file either moved out of scope
  // (kept) or is confirmed absent (detached). A correlated move already consumed
  // its old binding above, so it never lands here.
  const detached: string[] = []
  const outOfScope: string[] = []
  for (const binding of knownBindings) {
    if (consumed.has(binding.documentId)) continue
    if (!matchesSelectedPaths(binding.relativePath, root.selectedPaths)) {
      outOfScope.push(binding.documentId)
    } else {
      detached.push(binding.documentId)
    }
  }

  const ambiguous = resolved.filter((entry) => entry.strategy === "ambiguous")

  return {
    transactionId,
    bindingRootId: root.id,
    resolved,
    detached,
    outOfScope,
    ambiguous,
    unobservable: false,
  }
}

/**
 * Single-file identity resolution for the unified opener (ODE-375 M3).
 *
 * `reconcileRoot` diffs a whole root scan (and derives detaches); opening one
 * file must never imply the rest of the root disappeared. This reuses the exact
 * same priority ladder (`resolveFile`) for one observed file against the root's
 * known bindings, and only ever yields that file's `ResolvedBinding` — it emits
 * no detaches. Identity is still exhausted (manifest → path → inode → local hash
 * → cloud hash → ambiguous) before a UUID is minted.
 */
export function reconcileSingleFile(input: {
  file: ObservedFile
  bindingRootId: string
  knownBindings: KnownBinding[]
  cloudHashLookup?: CloudHashLookup
  mintId?: () => string
}): ResolvedBinding {
  const byPath = new Map<string, KnownBinding>()
  const byInode = new Map<number, KnownBinding>()
  const byHash = new Map<string, KnownBinding[]>()

  for (const binding of input.knownBindings) {
    byPath.set(binding.relativePath, binding)
    if (typeof binding.inode === "number" && binding.inode > 0) {
      byInode.set(binding.inode, binding)
    }
    if (binding.contentHash) {
      const bucket = byHash.get(binding.contentHash)
      if (bucket) bucket.push(binding)
      else byHash.set(binding.contentHash, [binding])
    }
  }

  return resolveFile(input.file, input.bindingRootId, {
    byPath,
    byInode,
    byHash,
    consumed: new Set<string>(),
    cloudHashLookup: input.cloudHashLookup,
    mintId: input.mintId ?? DEFAULT_MINT,
  })
}

function resolveFile(
  file: ObservedFile,
  bindingRootId: string,
  ctx: {
    byPath: Map<string, KnownBinding>
    byInode: Map<number, KnownBinding>
    byHash: Map<string, KnownBinding[]>
    consumed: Set<string>
    cloudHashLookup?: CloudHashLookup
    mintId: () => string
  },
): ResolvedBinding {
  const base = {
    bindingRootId,
    relativePath: file.relativePath,
    canonicalPath: file.canonicalPath,
    inode: file.inode,
    contentHash: file.contentHash,
    size: file.size,
    modifiedAt: file.modifiedAt,
  }

  const available = (binding: KnownBinding | undefined): binding is KnownBinding =>
    !!binding && !ctx.consumed.has(binding.documentId)

  // 0. durable manifest ledger identity: `.odessay/index.json` is the binding
  //    authority, so a recorded UUID wins over every heuristic below.
  if (file.manifestId && !ctx.consumed.has(file.manifestId)) {
    return { ...base, documentId: file.manifestId, strategy: "path" }
  }

  // 1. same relative path in the same root (wins even if inode/hash changed).
  const byPath = ctx.byPath.get(file.relativePath)
  if (available(byPath)) {
    return { ...base, documentId: byPath.documentId, strategy: "path" }
  }

  // 2. same inode in the root, or a correlated move (path gone, inode preserved).
  if (typeof file.inode === "number" && file.inode > 0) {
    const byInode = ctx.byInode.get(file.inode)
    if (available(byInode)) {
      return { ...base, documentId: byInode.documentId, strategy: "inode" }
    }
  }

  // 3. unique content_hash among known local bindings still available.
  if (file.contentHash) {
    const bucket = (ctx.byHash.get(file.contentHash) ?? []).filter(available)
    if (bucket.length === 1) {
      return { ...base, documentId: bucket[0].documentId, strategy: "local_hash" }
    }
    if (bucket.length > 1) {
      // Several local files share this hash: never auto-choose.
      return {
        ...base,
        documentId: null,
        strategy: "ambiguous",
        candidates: bucket.map((binding) => binding.documentId),
      }
    }

    // 4. unique content_hash in the cloud.
    const cloud = ctx.cloudHashLookup?.(file.contentHash)
    if (cloud === "ambiguous") {
      return { ...base, documentId: null, strategy: "ambiguous" }
    }
    if (typeof cloud === "string" && !ctx.consumed.has(cloud)) {
      return { ...base, documentId: cloud, strategy: "cloud_hash" }
    }
  }

  // 6. no match anywhere → mint a fresh UUID (identity was exhausted first).
  return { ...base, documentId: ctx.mintId(), strategy: "minted" }
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────
//
// The lifetime-scoped runtime that DesktopAppShell mounts once. It coalesces
// watcher bursts, runs the pure resolver per affected root, commits through the
// injected catalog transaction, and exposes a readiness state consumers can read
// without touching SQLite/manifests directly.

/**
 * Catalog readiness exposed to consumers (spec §Fallas y recuperación):
 *  - `idle`       : reconciler mounted, first scan not started;
 *  - `rebuilding` : scanning/projecting roots;
 *  - `ready`      : catalog reflects the last successful projection;
 *  - `stale`      : a root was unobservable, so the projection may lag reality;
 *  - `failed`     : a commit/scan failed hard and the catalog could not update.
 */
export type CatalogReadiness = "idle" | "rebuilding" | "ready" | "stale" | "failed"

export type ReconcileCommit = {
  transactionId: string
  bindingRootId: string
  rootPath: string
  visibleAsWorkspace: boolean
  /** All upserts carry a non-null documentId (ambiguous entries are excluded). */
  upserts: ResolvedBinding[]
  detached: string[]
}

export type WorkspaceReconcilerDeps = {
  /** Loads the registered BindingRoots (managed + external). */
  loadRoots: () => Promise<ReconcilerRoot[]>
  /**
   * Scans one root. `observed: null` signals the root is temporarily
   * unobservable (permission/mount loss) and must not detach anything.
   */
  scanRoot: (
    root: ReconcilerRoot,
  ) => Promise<{ observed: ObservedFile[] | null; knownBindings: KnownBinding[] }>
  /**
   * Applies one reconciliation transaction to the catalog and emits exactly one
   * CatalogChange for the whole burst. Ambiguous entries (documentId === null)
   * are excluded from `upserts` by the orchestrator.
   */
  commit: (commit: ReconcileCommit) => Promise<void>
  /** Optional cloud enrichment; must never block local readiness. */
  cloudHashLookup?: CloudHashLookup
  /** Burst coalescing window in ms (default 250). */
  coalesceMs?: number
  mintId?: () => string
  /** Injectable timers for deterministic tests. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export type WorkspaceReconciler = {
  /** Startup: load roots, scan/project locally, mark ready. Cloud is optional. */
  start: () => Promise<void>
  /** Queue a burst for one root; coalesces to a single transaction. */
  notifyRootChanged: (rootId: string) => void
  /** Force a full re-scan of every root (e.g. window focus after being stale). */
  rescanAll: () => Promise<void>
  getReadiness: () => CatalogReadiness
  subscribeReadiness: (listener: (state: CatalogReadiness) => void) => () => void
  /** Tear down pending timers. */
  dispose: () => void
}

export function createWorkspaceReconciler(
  deps: WorkspaceReconcilerDeps,
): WorkspaceReconciler {
  const coalesceMs = deps.coalesceMs ?? 250
  const mintId = deps.mintId ?? DEFAULT_MINT
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))

  let readiness: CatalogReadiness = "idle"
  const readinessListeners = new Set<(state: CatalogReadiness) => void>()
  let rootsById = new Map<string, ReconcilerRoot>()
  const pendingRootIds = new Set<string>()
  let burstTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function setReadiness(next: CatalogReadiness) {
    if (readiness === next) return
    readiness = next
    readinessListeners.forEach((listener) => listener(next))
  }

  async function reconcileOneRoot(root: ReconcilerRoot): Promise<boolean> {
    const { observed, knownBindings } = await deps.scanRoot(root)
    const result = reconcileRoot({
      root,
      observed,
      knownBindings,
      cloudHashLookup: deps.cloudHashLookup,
      mintId,
      transactionId: mintId(),
    })

    if (result.unobservable) {
      // Nothing to commit; the catalog is behind reality until the root returns.
      return false
    }

    const upserts = result.resolved.filter((entry) => entry.documentId !== null)
    await deps.commit({
      transactionId: result.transactionId,
      bindingRootId: result.bindingRootId,
      rootPath: root.rootPath,
      visibleAsWorkspace: root.visibleAsWorkspace,
      upserts,
      detached: result.detached,
    })
    return true
  }

  async function reconcileRootIds(rootIds: string[]): Promise<void> {
    let anyUnobservable = false
    for (const rootId of rootIds) {
      const root = rootsById.get(rootId)
      if (!root) continue
      try {
        const observedOk = await reconcileOneRoot(root)
        if (!observedOk) anyUnobservable = true
      } catch {
        // A hard scan/commit failure leaves the catalog as-is and surfaces
        // `failed`; it never fabricates deletes or drafts.
        setReadiness("failed")
        return
      }
    }
    setReadiness(anyUnobservable ? "stale" : "ready")
  }

  async function flushBurst() {
    burstTimer = null
    if (disposed) return
    const rootIds = Array.from(pendingRootIds)
    pendingRootIds.clear()
    if (rootIds.length === 0) return
    await reconcileRootIds(rootIds)
  }

  return {
    async start() {
      setReadiness("rebuilding")
      try {
        const roots = await deps.loadRoots()
        rootsById = new Map(roots.map((root) => [root.id, root]))
        await reconcileRootIds(roots.map((root) => root.id))
      } catch {
        setReadiness("failed")
      }
    },

    notifyRootChanged(rootId: string) {
      if (disposed) return
      pendingRootIds.add(rootId)
      if (burstTimer !== null) clearTimer(burstTimer)
      burstTimer = setTimer(() => {
        void flushBurst()
      }, coalesceMs)
    },

    async rescanAll() {
      const roots = await deps.loadRoots()
      rootsById = new Map(roots.map((root) => [root.id, root]))
      setReadiness("rebuilding")
      await reconcileRootIds(roots.map((root) => root.id))
    },

    getReadiness() {
      return readiness
    },

    subscribeReadiness(listener) {
      readinessListeners.add(listener)
      return () => readinessListeners.delete(listener)
    },

    dispose() {
      disposed = true
      if (burstTimer !== null) {
        clearTimer(burstTimer)
        burstTimer = null
      }
      readinessListeners.clear()
      pendingRootIds.clear()
    },
  }
}
