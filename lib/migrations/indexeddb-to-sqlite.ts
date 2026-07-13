import type {
  LocalWriting,
  SyncMutation,
  WritingSyncMutation,
} from "@/lib/local-db/schema"
import type {
  DesktopCatalogDualWriteInput,
} from "@/lib/services/desktop/tauri-commands"
import type { LocalDBScopeSnapshot } from "@/lib/local-db"

/**
 * ODE-376 · M5 — Desktop IndexedDB → SQLite catalog & sync-queue migration.
 *
 * This is a DATA migration, not a rewrite of the web local-first stack. It reads
 * every known desktop IndexedDB scope (anonymous + per-user), deduplicates
 * writings deterministically (UUID → binding path → canonical hash), reconciles
 * bindings against the durable manifest, and projects a document + optional
 * binding + optional writing-mutation into the SQLite DocumentCatalog for each
 * surviving record. It NEVER touches the filesystem, so a cloud-only record is
 * preserved as `local_present=false` and is never materialized into a `.md`
 * (catalog spec §Fallas; requirement 5). Ambiguous cases are recorded as
 * conflicts, never silently overwritten (requirement 3).
 *
 * All external effects are injected so the pipeline is exercised end-to-end in
 * unit tests without Tauri: the scope reader, the SQLite sink, the manifest
 * reconciler, the checkpoint store and the fan-out emitter are all ports.
 */

// ─── Ports ───────────────────────────────────────────────────────────────────

export type MigrationScopeReader = {
  listScopes(seed?: string[]): Promise<string[]>
  readScope(scope: string): Promise<LocalDBScopeSnapshot>
}

/**
 * Idempotent per-document SQLite commit. Mirrors `catalog_dual_write`: an
 * `INSERT ... ON CONFLICT DO UPDATE` on documents/bindings/sync_mutations keyed by
 * primary key, so re-running after an interrupted checkpoint converges instead of
 * duplicating. It NEVER emits a per-row catalog change — fan-out is a single
 * batch emit at the end of a run (Performance Contract: reactive fan-out).
 */
export type CatalogMigrationSink = {
  commit(input: DesktopCatalogDualWriteInput): Promise<void>
}

export type ManifestReconciler = {
  /**
   * Return the authoritative document id for a candidate binding path. The
   * durable manifest (`.odessay/index.json`) preserves identity across logout and
   * SQLite loss, so a manifest UUID for a path wins over the IndexedDB candidate.
   * For a local-only record with no manifest entry the reconciler preserves the
   * candidate id (identity default), so its UUID survives into SQLite and the
   * manifest (requirement 4).
   */
  resolveDocumentId(input: { canonicalPath: string; candidateId: string }): Promise<string>
}

export type MigrationCheckpoint = {
  checkpointVersion: 1
  status: "in-progress" | "completed" | "failed"
  processedScopes: string[]
  committedDocumentIds: string[]
  committedMutationIds: string[]
  conflicts: MigrationConflict[]
  documentCount: number
  mutationCount: number
  startedAt: number
  updatedAt: number
  error: string | null
}

export type MigrationCheckpointStore = {
  load(): Promise<MigrationCheckpoint | null>
  save(checkpoint: MigrationCheckpoint): Promise<void>
}

export type MigrationConflict = {
  kind: "uuid" | "path" | "hash" | "mutation" | "commit"
  documentId: string
  detail: string
  losing: {
    scope: string
    documentId: string
    canonicalPath: string | null
    contentHash: string | null
    version: number
  }
}

export type MigrationTelemetryEvent =
  | { type: "started"; scopes: string[]; resumed: boolean }
  | { type: "scope-harvested"; scope: string; writings: number; mutations: number; collections: number }
  | { type: "conflict"; conflict: MigrationConflict }
  | { type: "batch-emitted"; documentIds: string[] }
  | { type: "completed"; result: MigrationSummary }
  | { type: "failed"; error: string }

export type MigrationSummary = {
  status: "completed" | "failed"
  scopes: string[]
  documentCount: number
  localOnlyCount: number
  cloudOnlyCount: number
  mutationCount: number
  /** Collection + writing-collection mutations retained read-only in IndexedDB. */
  retainedCollectionMutationCount: number
  conflicts: MigrationConflict[]
  catalogChangesEmitted: number
  durationMs: number
}

export type MigrateIndexedDbToSqliteInput = {
  reader: MigrationScopeReader
  sink: CatalogMigrationSink
  reconciler?: ManifestReconciler
  checkpoint?: MigrationCheckpointStore
  telemetry?: (event: MigrationTelemetryEvent) => void
  /** Session-derived scopes to union with enumeration (e.g. the current user id). */
  scopeSeed?: string[]
  /** Emitted exactly once after the run commits — the single fan-out signal. */
  onBatchComplete?: (documentIds: string[]) => void
  now?: () => number
}

// ─── Identity reconciler default ─────────────────────────────────────────────

export const identityManifestReconciler: ManifestReconciler = {
  async resolveDocumentId({ candidateId }) {
    return candidateId
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isAnonymousScope = (scope: string) => scope === "anonymous"

function splitCanonicalPath(path: string) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator < 0
    ? { rootPath: ".", relativePath: path }
    : { rootPath: path.slice(0, separator), relativePath: path.slice(separator + 1) }
}

type Candidate = { scope: string; writing: LocalWriting }

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function candidatesDiverge(a: LocalWriting, b: LocalWriting): boolean {
  return (
    (a.canonical_path ?? null) !== (b.canonical_path ?? null) ||
    (a.content_hash ?? null) !== (b.content_hash ?? null) ||
    a.body_text !== b.body_text ||
    a.version !== b.version ||
    a.updated_at !== b.updated_at ||
    a.sync_status !== b.sync_status
  )
}

/**
 * Deterministic winner for a UUID that appears in more than one scope: higher
 * version, then later updated_at, then later local write, then an authenticated
 * scope over the anonymous scope, then a stable lexical scope order. Never random,
 * so a restart resolves the same way (requirement 3, failure mode: same UUID with
 * divergent data across anonymous/user scopes).
 */
function preferCandidate(a: Candidate, b: Candidate): Candidate {
  if (a.writing.version !== b.writing.version) {
    return a.writing.version > b.writing.version ? a : b
  }
  const ta = timestamp(a.writing.updated_at)
  const tb = timestamp(b.writing.updated_at)
  if (ta !== tb) return ta > tb ? a : b
  if (a.writing.local_updated_at !== b.writing.local_updated_at) {
    return a.writing.local_updated_at > b.writing.local_updated_at ? a : b
  }
  const aAnon = isAnonymousScope(a.scope)
  const bAnon = isAnonymousScope(b.scope)
  if (aAnon !== bAnon) return aAnon ? b : a
  return a.scope >= b.scope ? a : b
}

function documentSyncStatus(
  writing: LocalWriting,
  mutation: WritingSyncMutation | null,
  pathConflictLoser: boolean,
): string {
  if (pathConflictLoser) return "conflict"
  if (writing.sync_status === "deleted") return "deleted"
  if (mutation) return mutation.attempts > 0 || mutation.last_error ? "failed" : "pending"
  if (writing.sync_status === "failed") return "failed"
  if (writing.sync_status === "synced" || writing.lifecycle === "server-confirmed") return "synced"
  return "local-only"
}

function mutationStatus(mutation: WritingSyncMutation): string {
  return mutation.attempts > 0 || mutation.last_error ? "failed" : "pending"
}

/**
 * The binding path a record projects into SQLite, or null when it must be
 * unbound. A `deleted` tombstone still carries its old `canonical_path` (soft
 * delete spreads the record without nulling it), but it is NOT the live owner of
 * that file — a live document can reclaim the same path (workspace-service delete
 * on path reuse). Emitting a binding for a tombstone would collide with the live
 * document on `UNIQUE(canonical_path)` and fail the whole migration, so a tombstone
 * — like a path-conflict loser — projects no binding.
 */
function bindingPathFor(writing: LocalWriting, unbound: boolean): string | null {
  if (unbound || writing.sync_status === "deleted") return null
  return writing.canonical_path?.trim() || null
}

function toSinkInput(
  writing: LocalWriting,
  mutation: WritingSyncMutation | null,
  pathConflictLoser: boolean,
): DesktopCatalogDualWriteInput {
  const canonicalPath = bindingPathFor(writing, pathConflictLoser)
  const pathParts = canonicalPath ? splitCanonicalPath(canonicalPath) : null
  const localPresent = Boolean(canonicalPath)
  const cloudPresent =
    writing.lifecycle === "server-confirmed" || writing.sync_status === "synced"

  return {
    document: {
      id: writing.id,
      localPresent,
      cloudPresent,
      cloudAccountId: writing.author_id ?? null,
      syncStatus: documentSyncStatus(writing, mutation, pathConflictLoser),
      title: writing.title ?? null,
      slug: writing.slug ?? null,
      status: writing.status,
      artifactType: writing.artifact_type ?? "general",
      visibility: writing.visibility,
      version: writing.version,
      createdAt: timestamp(writing.created_at) || null,
      modifiedAt: timestamp(writing.updated_at) || null,
    },
    binding:
      canonicalPath && pathParts
        ? {
            bindingRootId: `legacy-root:${pathParts.rootPath}`,
            rootPath: pathParts.rootPath,
            manifestVersion: 1,
            visibleAsWorkspace: false,
            relativePath: pathParts.relativePath,
            canonicalPath,
            inode: null,
            contentHash: writing.content_hash ?? null,
            size: null,
            lastSeenAt: writing.local_updated_at,
          }
        : null,
    mutation: mutation
      ? {
          id: mutation.id,
          operation: mutation.operation,
          payloadJson: JSON.stringify(mutation.payload),
          status: mutationStatus(mutation),
          attemptCount: mutation.attempts,
          nextRetryAt: mutation.next_retry_at ?? null,
          createdAt: mutation.created_at,
          lastError: mutation.last_error ?? null,
        }
      : null,
  }
}

function isWritingMutation(mutation: SyncMutation): mutation is WritingSyncMutation {
  return mutation.entity_kind === "writing"
}

// ─── Migration ───────────────────────────────────────────────────────────────

export async function migrateIndexedDbToSqlite(
  input: MigrateIndexedDbToSqliteInput,
): Promise<MigrationSummary> {
  const {
    reader,
    sink,
    reconciler = identityManifestReconciler,
    checkpoint,
    telemetry = () => {},
    scopeSeed = [],
    onBatchComplete,
    now = () => Date.now(),
  } = input

  const startedAtMs = now()

  const existing = (await checkpoint?.load()) ?? null
  if (existing?.status === "completed") {
    // Already migrated on a previous run — do nothing (idempotent restart).
    return {
      status: "completed",
      scopes: existing.processedScopes,
      documentCount: existing.documentCount,
      localOnlyCount: 0,
      cloudOnlyCount: 0,
      mutationCount: existing.mutationCount,
      retainedCollectionMutationCount: 0,
      conflicts: existing.conflicts,
      catalogChangesEmitted: 0,
      durationMs: 0,
    }
  }

  const committedDocumentIds = new Set(existing?.committedDocumentIds ?? [])
  const committedMutationIds = new Set(existing?.committedMutationIds ?? [])
  const conflicts: MigrationConflict[] = [...(existing?.conflicts ?? [])]
  const resumed = Boolean(existing)

  const state: MigrationCheckpoint = {
    checkpointVersion: 1,
    status: "in-progress",
    processedScopes: [...(existing?.processedScopes ?? [])],
    committedDocumentIds: [...committedDocumentIds],
    committedMutationIds: [...committedMutationIds],
    conflicts,
    documentCount: existing?.documentCount ?? 0,
    mutationCount: existing?.mutationCount ?? 0,
    startedAt: existing?.startedAt ?? startedAtMs,
    updatedAt: startedAtMs,
    error: null,
  }

  // Fingerprint conflicts so a resume — which re-harvests every scope and
  // re-detects the same divergences — does not append duplicate entries to a
  // checkpoint that already carries them.
  const conflictFingerprint = (conflict: MigrationConflict) =>
    `${conflict.kind}:${conflict.documentId}:${conflict.losing.scope}:${conflict.losing.documentId}`
  const seenConflicts = new Set(conflicts.map(conflictFingerprint))
  const recordConflict = (conflict: MigrationConflict) => {
    const fingerprint = conflictFingerprint(conflict)
    if (seenConflicts.has(fingerprint)) return
    seenConflicts.add(fingerprint)
    conflicts.push(conflict)
    telemetry({ type: "conflict", conflict })
  }

  try {
    const scopes = await reader.listScopes(scopeSeed)
    telemetry({ type: "started", scopes, resumed })

    // ── Harvest every scope (read-only) ──────────────────────────────────────
    const allCandidates: Candidate[] = []
    const writingMutationsById = new Map<string, { mutation: WritingSyncMutation; scope: string }>()
    let retainedCollectionMutationCount = 0

    for (const scope of scopes) {
      const snapshot = await reader.readScope(scope)
      for (const writing of snapshot.writings) {
        allCandidates.push({ scope, writing })
      }
      for (const mutation of snapshot.mutations) {
        if (isWritingMutation(mutation)) {
          // A UUID's queue row is unique per scope. On a cross-scope collision a
          // single document row cannot replay two divergent upserts, so the
          // newest-created row wins — but the superseded row is RECORDED as a
          // migration conflict (never silently dropped) so it stays recoverable
          // and its divergence is visible (requirement 3/6).
          const previous = writingMutationsById.get(mutation.entity_id)
          if (!previous) {
            writingMutationsById.set(mutation.entity_id, { mutation, scope })
          } else if (mutation.id !== previous.mutation.id) {
            const winner = mutation.created_at >= previous.mutation.created_at
              ? { mutation, scope }
              : previous
            const loser = winner.mutation.id === mutation.id ? previous : { mutation, scope }
            writingMutationsById.set(mutation.entity_id, winner)
            recordConflict({
              kind: "mutation",
              documentId: mutation.entity_id,
              detail: `Queue rows ${previous.mutation.id} and ${mutation.id} target document ${mutation.entity_id} across scopes; the superseded row is retained read-only in IndexedDB`,
              losing: {
                scope: loser.scope,
                documentId: loser.mutation.id,
                canonicalPath: null,
                contentHash: null,
                version: loser.mutation.payload.version,
              },
            })
          }
        } else {
          // Collection / writing-collection mutations have no SQLite catalog
          // schema (the queue is document-scoped). They survive because desktop
          // IndexedDB is retained read-only for one release; they are counted,
          // never dropped (requirement 2/6).
          retainedCollectionMutationCount += 1
        }
      }
      telemetry({
        type: "scope-harvested",
        scope,
        writings: snapshot.writings.length,
        mutations: snapshot.mutations.length,
        collections: snapshot.collections.length,
      })
    }

    // ── Dedup by UUID across scopes ──────────────────────────────────────────
    const winnerById = new Map<string, Candidate>()
    for (const candidate of allCandidates) {
      const current = winnerById.get(candidate.writing.id)
      if (!current) {
        winnerById.set(candidate.writing.id, candidate)
        continue
      }
      const winner = preferCandidate(current, candidate)
      const loser = winner === current ? candidate : current
      if (candidatesDiverge(current.writing, candidate.writing)) {
        recordConflict({
          kind: "uuid",
          documentId: candidate.writing.id,
          detail: `UUID present in scopes "${current.scope}" and "${candidate.scope}" with divergent data`,
          losing: {
            scope: loser.scope,
            documentId: loser.writing.id,
            canonicalPath: loser.writing.canonical_path ?? null,
            contentHash: loser.writing.content_hash ?? null,
            version: loser.writing.version,
          },
        })
      }
      winnerById.set(candidate.writing.id, winner)
    }

    const winners = [...winnerById.values()]

    // ── Dedup by binding path ────────────────────────────────────────────────
    // Two different UUIDs cannot bind the same file (SQLite UNIQUE canonical_path).
    // Keep the deterministic winner bound; the loser keeps its document + queue
    // row but WITHOUT a binding (never overwrite, never drop the queue row).
    const winnerByPath = new Map<string, Candidate>()
    const pathConflictLosers = new Set<string>()
    for (const candidate of winners) {
      const path = candidate.writing.canonical_path?.trim()
      if (!path || candidate.writing.sync_status === "deleted") continue
      const current = winnerByPath.get(path)
      if (!current) {
        winnerByPath.set(path, candidate)
        continue
      }
      const winner = preferCandidate(current, candidate)
      const loser = winner === current ? candidate : current
      winnerByPath.set(path, winner)
      pathConflictLosers.add(loser.writing.id)
      recordConflict({
        kind: "path",
        documentId: loser.writing.id,
        detail: `Canonical path "${path}" claimed by documents ${current.writing.id} and ${candidate.writing.id}`,
        losing: {
          scope: loser.scope,
          documentId: loser.writing.id,
          canonicalPath: path,
          contentHash: loser.writing.content_hash ?? null,
          version: loser.writing.version,
        },
      })
    }

    // ── Detect ambiguous hash among unbound records ──────────────────────────
    const unboundByHash = new Map<string, Candidate>()
    for (const candidate of winners) {
      const hasPath = Boolean(candidate.writing.canonical_path?.trim())
      const hash = candidate.writing.content_hash?.trim()
      if (hasPath || !hash) continue
      const current = unboundByHash.get(hash)
      if (!current) {
        unboundByHash.set(hash, candidate)
        continue
      }
      recordConflict({
        kind: "hash",
        documentId: candidate.writing.id,
        detail: `Unbound records ${current.writing.id} and ${candidate.writing.id} share content hash "${hash}"`,
        losing: {
          scope: candidate.scope,
          documentId: candidate.writing.id,
          canonicalPath: null,
          contentHash: hash,
          version: candidate.writing.version,
        },
      })
    }

    // ── Reconcile bindings against the manifest, then commit ─────────────────
    const emittedDocumentIds: string[] = []
    let localOnlyCount = 0
    let cloudOnlyCount = 0

    for (const candidate of winners) {
      let writing = candidate.writing
      const isLoser = pathConflictLosers.has(writing.id)
      const canonicalPath = bindingPathFor(writing, isLoser)

      if (canonicalPath) {
        const authoritativeId = await reconciler.resolveDocumentId({
          canonicalPath,
          candidateId: writing.id,
        })
        if (authoritativeId !== writing.id) {
          writing = { ...writing, id: authoritativeId }
        }
      }

      if (committedDocumentIds.has(writing.id)) {
        continue
      }

      const mutation = writingMutationsById.get(candidate.writing.id)?.mutation ?? null
      const rekeyedMutation =
        mutation && mutation.entity_id !== writing.id
          ? { ...mutation, entity_id: writing.id }
          : mutation

      try {
        await sink.commit(toSinkInput(writing, rekeyedMutation, isLoser))
      } catch (error) {
        // A single row that the sink rejects (an unexpected constraint clash in
        // messy historical data) must NOT abort the whole bulk copy. Record it as
        // a conflict — non-silent, recoverable, and it keeps the old store intact
        // (requirement 3/8) — and continue with the rest of the batch.
        recordConflict({
          kind: "commit",
          documentId: writing.id,
          detail: `SQLite commit rejected document ${writing.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          losing: {
            scope: candidate.scope,
            documentId: writing.id,
            canonicalPath: canonicalPath,
            contentHash: writing.content_hash ?? null,
            version: writing.version,
          },
        })
        continue
      }

      committedDocumentIds.add(writing.id)
      emittedDocumentIds.push(writing.id)
      if (canonicalPath) localOnlyCount += 1
      else if (writing.lifecycle === "server-confirmed" || writing.sync_status === "synced") {
        cloudOnlyCount += 1
      }
      if (rekeyedMutation && !committedMutationIds.has(rekeyedMutation.id)) {
        committedMutationIds.add(rekeyedMutation.id)
      }

      // Checkpoint after every commit so an interruption resumes idempotently.
      state.processedScopes = scopes
      state.committedDocumentIds = [...committedDocumentIds]
      state.committedMutationIds = [...committedMutationIds]
      state.conflicts = conflicts
      state.documentCount = committedDocumentIds.size
      state.mutationCount = committedMutationIds.size
      state.updatedAt = now()
      await checkpoint?.save(state)
    }

    // ── Single fan-out signal for the whole batch ────────────────────────────
    if (emittedDocumentIds.length > 0) {
      onBatchComplete?.(emittedDocumentIds)
      telemetry({ type: "batch-emitted", documentIds: emittedDocumentIds })
    }

    const summary: MigrationSummary = {
      status: "completed",
      scopes,
      documentCount: committedDocumentIds.size,
      localOnlyCount,
      cloudOnlyCount,
      mutationCount: committedMutationIds.size,
      retainedCollectionMutationCount,
      conflicts,
      catalogChangesEmitted: emittedDocumentIds.length > 0 ? 1 : 0,
      durationMs: now() - startedAtMs,
    }

    state.status = "completed"
    state.updatedAt = now()
    await checkpoint?.save(state)
    telemetry({ type: "completed", result: summary })
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : "IndexedDB→SQLite migration failed"
    state.status = "failed"
    state.error = message
    state.conflicts = conflicts
    state.updatedAt = now()
    // Persist a failed checkpoint so the next launch resumes rather than losing
    // progress. Old stores are NOT deleted on failure (requirement 8).
    await checkpoint?.save(state)
    telemetry({ type: "failed", error: message })
    throw error
  }
}
