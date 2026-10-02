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
  /**
   * Volume the file lives on (`st_dev`, mirrored from the Rust scan). An inode
   * is only unique within one volume, so cross-root correlation requires the
   * origin and the destination to share it (ODE-657 review P1). `null` when a
   * recording/mock predates the field or the platform cannot report it.
   */
  device: number | null
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

/**
 * Evidence for a file a scan could not bind: no manifest entry and no
 * caller-supplied id. Mirrors `WorkspaceUnboundFile` (Rust) minus the parts the
 * correlation does not read. The scan already computed all of this while
 * deciding the file was unbound.
 */
export type UnboundFile = {
  relativePath: string
  inode: number | null
  /** Volume the file lives on (`st_dev`), same contract as `ObservedFile`. */
  device: number | null
  contentHash: string | null
  size: number | null
  modifiedAt: number | null
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

// ─── Cross-root correlation ────────────────────────────────────────────────────

/**
 * One root's evidence for a single reconciliation pass (ODE-657).
 *
 * `detached` is the subset of `reconcileRoot`'s output that a move can
 * correlate against: bindings whose path this pass confirmed physically absent.
 * A binding that is merely out of scope, or a root that could not be scanned,
 * never contributes candidates.
 */
export type CrossRootCorrelationRoot = {
  rootId: string
  /** false when the scan failed: the root neither detaches nor offers candidates. */
  observable: boolean
  /**
   * The single volume every file this pass observed in the root lives on, or
   * `null` when the root offered no file evidence or spanned several volumes.
   * A detached binding is only a candidate when its origin root's volume is
   * known to match the unbound file's volume (ODE-657 review P1).
   */
  device: number | null
  unbound: UnboundFile[]
  detached: KnownBinding[]
}

export type CrossRootCorrelation = {
  /** rootId → (relativePath → documentId) for every unbound file in the pass. */
  idsByRoot: Map<string, Map<string, string>>
  /** documentIds that resolved a cross-root move (subset of the values above). */
  correlatedIds: Set<string>
}

/**
 * Pure correlation of externally-moved files across BindingRoots (ODE-657).
 *
 * A file moved outside the app from root A to root B is reported by B's scan as
 * unbound while A's scan confirms its old binding absent. Before any UUID is
 * minted, this pass matches each unbound file against the detached bindings of
 * *other* roots in the same pass, requiring same device **and** same inode
 * (both > 0) **and** same non-null content_hash. An inode is only unique within
 * one volume: a detached binding is compared against its origin root's known
 * volume, an unbound file against its own. If either side's volume is unknown
 * or they differ, they never share a key — the unbound file gets a fresh id
 * here and the origin stays detached (ODE-657 review P1). Only a strict 1↔1
 * relation correlates: one unbound file, one detached binding.
 *
 * Every unbound file gets an id in `idsByRoot` (correlated or minted), so the
 * caller can bind the whole set in one manifest write.
 */
export function correlateAcrossRoots(input: {
  roots: CrossRootCorrelationRoot[]
  mintId?: () => string
}): CrossRootCorrelation {
  const mintId = input.mintId ?? DEFAULT_MINT
  const idsByRoot = new Map<string, Map<string, string>>()
  const correlatedIds = new Set<string>()

  type UnboundEntry = { rootId: string; file: UnboundFile }
  type DetachedEntry = { rootId: string; binding: KnownBinding }
  const unboundByKey = new Map<string, UnboundEntry[]>()
  const detachedByKey = new Map<string, DetachedEntry[]>()

  const keyFor = (
    device: number | null,
    inode: number | null,
    contentHash: string | null,
  ): string | null =>
    typeof device === "number" &&
    device > 0 &&
    typeof inode === "number" &&
    inode > 0 &&
    contentHash
      ? `${device}\u0000${inode}\u0000${contentHash}`
      : null

  for (const root of input.roots) {
    const ids = new Map<string, string>()
    idsByRoot.set(root.rootId, ids)
    if (!root.observable) continue
    for (const file of root.unbound) {
      ids.set(file.relativePath, mintId())
      const key = keyFor(file.device, file.inode, file.contentHash)
      if (!key) continue
      const bucket = unboundByKey.get(key)
      if (bucket) bucket.push({ rootId: root.rootId, file })
      else unboundByKey.set(key, [{ rootId: root.rootId, file }])
    }
    for (const binding of root.detached) {
      const key = keyFor(root.device, binding.inode, binding.contentHash)
      if (!key) continue
      const bucket = detachedByKey.get(key)
      if (bucket) bucket.push({ rootId: root.rootId, binding })
      else detachedByKey.set(key, [{ rootId: root.rootId, binding }])
    }
  }

  for (const [key, unboundEntries] of unboundByKey) {
    const detachedEntries = detachedByKey.get(key) ?? []
    for (const entry of unboundEntries) {
      // The origin must be another root's confirmed detach.
      const candidates = detachedEntries.filter((candidate) => candidate.rootId !== entry.rootId)
      if (candidates.length !== 1) continue
      const candidate = candidates[0]
      // 1↔1: the candidate must be consumable by exactly this one file.
      const rivals = unboundEntries.filter((rival) => rival.rootId !== candidate.rootId)
      if (rivals.length !== 1) continue
      idsByRoot.get(entry.rootId)!.set(entry.file.relativePath, candidate.binding.documentId)
      correlatedIds.add(candidate.binding.documentId)
    }
  }

  return { idsByRoot, correlatedIds }
}

/**
 * The one volume every file this pass saw in a root lives on, or `null` when
 * the root offered no file evidence or its files span several volumes.
 * Cross-root correlation must never infer a shared volume from an inode alone,
 * so an unknown root volume simply produces no candidates (ODE-657 review P1).
 */
function rootDeviceFor(
  observed: ObservedFile[] | null,
  unbound: UnboundFile[],
): number | null {
  const devices = new Set<number>()
  for (const file of [...(observed ?? []), ...unbound]) {
    if (typeof file.device === "number" && file.device > 0) devices.add(file.device)
  }
  return devices.size === 1 ? [...devices][0] : null
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
   * `unbound` carries the evidence (inode/hash/size) for files the scan could
   * not bind, in the same order as the scan reported them.
   */
  scanRoot: (
    root: ReconcilerRoot,
  ) => Promise<{
    observed: ObservedFile[] | null
    unbound?: UnboundFile[]
    knownBindings: KnownBinding[]
  }>
  /**
   * Binds the ids this pass decided for one root's unbound files — a single
   * manifest write — and returns the refreshed observed list. Optional:
   * orchestrator tests that never produce unbound files do not wire it.
   */
  bindUnbound?: (root: ReconcilerRoot, ids: Record<string, string>) => Promise<ObservedFile[]>
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

  type ScannedRoot = {
    root: ReconcilerRoot
    unbound: UnboundFile[]
    knownBindings: KnownBinding[]
    result: ReconcileRootResult
    /** Volume shared by every file this pass saw in the root, else null. */
    device: number | null
  }

  /**
   * One pass over the affected roots, in four phases (ODE-657):
   *
   *   1. scan every root and resolve its bound files (isolated failures);
   *   2. correlate unbound files against other roots' confirmed detaches on the
   *      same volume;
   *   3. bind each root's decided ids — manifest before SQLite — and re-resolve;
   *   4. commit once per root, subtracting from every detach the ids claimed
   *      anywhere in the pass.
   *
   * The order of the commits stops mattering because the binding is keyed by
   * document id: root B's upsert replaces A's binding row, so A must not later
   * detach the same id. An unobservable root neither detaches nor contributes
   * candidates, and a failed bind leaves the correlated id out of the detach
   * (the stale binding is recoverable on the next pass) while surfacing
   * `failed`.
   */
  async function reconcileRootIds(rootIds: string[]): Promise<void> {
    let anyUnobservable = false
    let anyFailed = false

    // Phase 1 — scan and resolve. A scan failure stays isolated per root.
    const scanned: ScannedRoot[] = []
    for (const rootId of rootIds) {
      const root = rootsById.get(rootId)
      if (!root) continue
      try {
        const { observed, unbound, knownBindings } = await deps.scanRoot(root)
        const result = reconcileRoot({
          root,
          observed,
          knownBindings,
          cloudHashLookup: deps.cloudHashLookup,
          mintId,
          transactionId: mintId(),
        })
        if (result.unobservable) anyUnobservable = true
        const unboundFiles = unbound ?? []
        scanned.push({
          root,
          unbound: unboundFiles,
          knownBindings,
          result,
          device: rootDeviceFor(observed, unboundFiles),
        })
      } catch {
        // Isolate failures by root. One unavailable/legacy root must not prevent
        // newly adopted roots from reaching the shared catalog. The failed root
        // remains untouched and overall readiness still surfaces the problem.
        anyFailed = true
      }
    }

    // Phase 2 — correlate before any identity is minted.
    const correlation = correlateAcrossRoots({
      roots: scanned.map((entry) => ({
        rootId: entry.root.id,
        observable: !entry.result.unobservable,
        device: entry.result.unobservable ? null : entry.device,
        unbound: entry.unbound,
        detached: entry.result.unobservable
          ? []
          : entry.knownBindings.filter((binding) =>
              entry.result.detached.includes(binding.documentId),
            ),
      })),
      mintId,
    })

    // Phase 3 — bind (manifest) and re-resolve, collecting the final upserts.
    const finalById = new Map<
      string,
      { entry: ScannedRoot; upserts: ResolvedBinding[]; detached: string[] }
    >()
    const upsertedIds = new Set<string>()
    for (const entry of scanned) {
      if (entry.result.unobservable) continue
      let result = entry.result
      const ids = correlation.idsByRoot.get(entry.root.id)
      if (ids && ids.size > 0 && deps.bindUnbound) {
        try {
          const observed = await deps.bindUnbound(entry.root, Object.fromEntries(ids))
          result = reconcileRoot({
            root: entry.root,
            observed,
            knownBindings: entry.knownBindings,
            cloudHashLookup: deps.cloudHashLookup,
            mintId,
            transactionId: entry.result.transactionId,
          })
        } catch {
          // The correlated id still must not detach (no data loss): the origin
          // binding goes stale and the next pass re-correlates. Readiness fails.
          anyFailed = true
        }
      }
      const upserts = result.resolved.filter((candidate) => candidate.documentId !== null)
      for (const upsert of upserts) upsertedIds.add(upsert.documentId as string)
      finalById.set(entry.root.id, { entry, upserts, detached: result.detached })
    }

    // Phase 4 — one commit per root, independent of commit order.
    for (const entry of scanned) {
      const final = finalById.get(entry.root.id)
      if (!final) continue
      const detached = final.detached.filter(
        (id) => !upsertedIds.has(id) && !correlation.correlatedIds.has(id),
      )
      try {
        await deps.commit({
          transactionId: entry.result.transactionId,
          bindingRootId: entry.result.bindingRootId,
          rootPath: entry.root.rootPath,
          visibleAsWorkspace: entry.root.visibleAsWorkspace,
          upserts: final.upserts,
          detached,
        })
      } catch {
        anyFailed = true
      }
    }

    setReadiness(anyFailed ? "failed" : anyUnobservable ? "stale" : "ready")
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
