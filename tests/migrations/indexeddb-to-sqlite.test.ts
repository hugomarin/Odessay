import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  migrateIndexedDbToSqlite,
  type CatalogMigrationSink,
  type MigrationCheckpoint,
  type MigrationCheckpointStore,
  type MigrationScopeReader,
} from "@/lib/migrations/indexeddb-to-sqlite"
import type { DesktopCatalogDualWriteInput } from "@/lib/services/desktop/tauri-commands"
import type {
  LocalDBScopeSnapshot,
} from "@/lib/local-db"
import type { LocalWriting, SyncMutation, WritingSyncMutation } from "@/lib/local-db/schema"

// ─── Fixture builders ──────────────────────────────────────────────────────

function writing(overrides: Partial<LocalWriting> & { id: string }): LocalWriting {
  return {
    author_id: "user-1",
    title: "Doc",
    body_json: { type: "doc" },
    body_text: "body",
    status: "draft",
    artifact_type: "general",
    visibility: "private",
    version: 1,
    sync_status: "pending",
    lifecycle: "local-only",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    local_updated_at: 1,
    ...overrides,
  }
}

function mutation(overrides: Partial<WritingSyncMutation> & { id: string; entity_id: string }): WritingSyncMutation {
  return {
    entity_kind: "writing",
    entity_key: `writing:${overrides.entity_id}`,
    operation: "upsert",
    payload: {
      body_json: { type: "doc" },
      body_text: "body",
      status: "draft",
      artifact_type: "general",
      visibility: "private",
      version: 1,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    created_at: 1,
    attempts: 0,
    ...overrides,
  }
}

function snapshot(scope: string, partial: Partial<Omit<LocalDBScopeSnapshot, "scope">> = {}): LocalDBScopeSnapshot {
  return {
    scope,
    writings: partial.writings ?? [],
    collections: partial.collections ?? [],
    writingCollections: partial.writingCollections ?? [],
    mutations: partial.mutations ?? [],
  }
}

/** In-memory SQLite stand-in that enforces the real UNIQUE constraints. */
function makeSink() {
  const documents = new Map<string, DesktopCatalogDualWriteInput["document"]>()
  const bindings = new Map<string, string>() // canonicalPath -> documentId
  const mutations = new Map<string, DesktopCatalogDualWriteInput["mutation"] & { documentId: string }>()
  const sink: CatalogMigrationSink = {
    async commit(input) {
      documents.set(input.document.id, input.document)
      if (input.binding) {
        const owner = bindings.get(input.binding.canonicalPath)
        if (owner && owner !== input.document.id) {
          throw new Error(`UNIQUE constraint failed: document_bindings.canonical_path (${input.binding.canonicalPath})`)
        }
        bindings.set(input.binding.canonicalPath, input.document.id)
      }
      if (input.mutation) {
        mutations.set(input.mutation.id, { ...input.mutation, documentId: input.document.id })
      }
    },
  }
  return { sink, documents, bindings, mutations }
}

function reader(snapshots: Record<string, LocalDBScopeSnapshot>): MigrationScopeReader {
  return {
    async listScopes() {
      return Object.keys(snapshots)
    },
    async readScope(scope) {
      return snapshots[scope] ?? snapshot(scope)
    },
  }
}

function memoryCheckpoint(): MigrationCheckpointStore & { current: MigrationCheckpoint | null } {
  const store = {
    current: null as MigrationCheckpoint | null,
    async load() {
      return store.current
    },
    async save(checkpoint: MigrationCheckpoint) {
      store.current = structuredClone(checkpoint)
    },
  }
  return store
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ODE-376 · IndexedDB → SQLite migration", () => {
  it("harvests anonymous and user scopes into a single deduplicated catalog", async () => {
    const { sink, documents } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", { writings: [writing({ id: "a", canonical_path: "/root/a.md" })] }),
        "user-1": snapshot("user-1", { writings: [writing({ id: "b", canonical_path: "/root/b.md" })] }),
      }),
      sink,
    })

    expect(summary.status).toBe("completed")
    expect(summary.scopes).toEqual(["anonymous", "user-1"])
    expect([...documents.keys()].sort()).toEqual(["a", "b"])
    expect(summary.documentCount).toBe(2)
  })

  it("records a UUID conflict across scopes and keeps the deterministic winner", async () => {
    const { sink, documents } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [writing({ id: "dup", version: 1, body_text: "old", canonical_path: "/root/anon.md" })],
        }),
        "user-1": snapshot("user-1", {
          writings: [writing({ id: "dup", version: 3, body_text: "new", canonical_path: "/root/user.md" })],
        }),
      }),
      sink,
    })

    expect(documents.size).toBe(1)
    expect(summary.conflicts).toHaveLength(1)
    expect(summary.conflicts[0]).toMatchObject({ kind: "uuid", documentId: "dup" })
    // Higher version (user scope) wins.
    expect(documents.get("dup")?.version).toBe(3)
  })

  it("records a path conflict and leaves the loser bound to no file", async () => {
    const { sink, documents, bindings } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [
            writing({ id: "keep", version: 2, canonical_path: "/root/same.md" }),
            writing({ id: "lose", version: 1, canonical_path: "/root/same.md" }),
          ],
        }),
      }),
      sink,
    })

    expect(bindings.get("/root/same.md")).toBe("keep")
    expect(summary.conflicts.some((c) => c.kind === "path" && c.documentId === "lose")).toBe(true)
    // The loser is preserved without a binding and marked as a conflict.
    expect(documents.get("lose")?.localPresent).toBe(false)
    expect(documents.get("lose")?.syncStatus).toBe("conflict")
  })

  it("never emits a binding for a deleted tombstone that shares a path with a live doc", async () => {
    // A soft-deleted record keeps its old canonical_path; a live document can
    // reclaim that path. The tombstone must project no binding, or catalog
    // dual-write would fail on UNIQUE(canonical_path) and loop the migration.
    const { sink, documents, bindings } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [
            writing({ id: "tomb", canonical_path: "/root/reused.md", sync_status: "deleted", deleted_at: "2026-01-02T00:00:00.000Z" }),
            writing({ id: "live", canonical_path: "/root/reused.md", version: 2 }),
          ],
          mutations: [mutation({ id: "m-tomb", entity_id: "tomb", operation: "delete" })],
        }),
      }),
      sink,
    })

    // No UNIQUE violation: the migration completes and the live doc owns the path.
    expect(summary.status).toBe("completed")
    expect(bindings.get("/root/reused.md")).toBe("live")
    expect(documents.get("tomb")?.localPresent).toBe(false)
    // The tombstone (and its delete queue row) is still preserved.
    expect(documents.has("tomb")).toBe(true)
    // The tombstone is not counted as a path conflict — it simply never binds.
    expect(summary.conflicts.some((c) => c.kind === "path")).toBe(false)
  })

  it("records a mutation conflict for a superseded cross-scope queue row", async () => {
    const { sink, mutations } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [writing({ id: "shared", canonical_path: "/root/anon.md" })],
          mutations: [mutation({ id: "m-old", entity_id: "shared", created_at: 1 })],
        }),
        "user-1": snapshot("user-1", {
          writings: [writing({ id: "shared", version: 2, canonical_path: "/root/user.md" })],
          mutations: [mutation({ id: "m-new", entity_id: "shared", created_at: 5 })],
        }),
      }),
      sink,
    })

    // Newest queue row wins into SQLite; the superseded one is recorded, not dropped.
    expect(mutations.has("m-new")).toBe(true)
    expect(mutations.has("m-old")).toBe(false)
    expect(summary.conflicts.some((c) => c.kind === "mutation" && c.losing.documentId === "m-old")).toBe(true)
  })

  it("records an ambiguous hash for two unbound records sharing a content hash", async () => {
    const { sink } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [
            writing({ id: "h1", canonical_path: null, content_hash: "blake3:same" }),
            writing({ id: "h2", canonical_path: null, content_hash: "blake3:same" }),
          ],
        }),
      }),
      sink,
    })

    expect(summary.conflicts.some((c) => c.kind === "hash")).toBe(true)
  })

  it("preserves a cloud-only record as local_present=false and never materializes a file", async () => {
    const { sink, documents, bindings } = makeSink()
    await migrateIndexedDbToSqlite({
      reader: reader({
        "user-1": snapshot("user-1", {
          writings: [
            writing({
              id: "cloud",
              canonical_path: null,
              sync_status: "synced",
              lifecycle: "server-confirmed",
            }),
          ],
        }),
      }),
      sink,
    })

    const row = documents.get("cloud")!
    expect(row.localPresent).toBe(false)
    expect(row.cloudPresent).toBe(true)
    expect(bindings.size).toBe(0) // no binding => no file materialized
  })

  it("preserves a local-only UUID and its binding", async () => {
    const { sink, documents, bindings } = makeSink()
    await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [writing({ id: "local-uuid", canonical_path: "/root/local.md", lifecycle: "local-only" })],
        }),
      }),
      sink,
    })

    expect(documents.get("local-uuid")?.localPresent).toBe(true)
    expect(bindings.get("/root/local.md")).toBe("local-uuid")
  })

  it("copies pending, failed and delete queue rows with payload, attempts and retry", async () => {
    const { sink, mutations } = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [
            writing({ id: "p", canonical_path: "/root/p.md" }),
            writing({ id: "f", canonical_path: "/root/f.md" }),
            writing({ id: "d", canonical_path: "/root/d.md", sync_status: "deleted" }),
          ],
          mutations: [
            mutation({ id: "m-p", entity_id: "p", attempts: 0 }),
            mutation({ id: "m-f", entity_id: "f", attempts: 2, last_error: "boom", next_retry_at: 9999 }),
            mutation({ id: "m-d", entity_id: "d", operation: "delete", attempts: 0 }),
          ],
        }),
      }),
      sink,
    })

    expect(summary.mutationCount).toBe(3)
    expect(mutations.get("m-p")?.status).toBe("pending")
    expect(mutations.get("m-f")?.status).toBe("failed")
    expect(mutations.get("m-f")?.attemptCount).toBe(2)
    expect(mutations.get("m-f")?.nextRetryAt).toBe(9999)
    expect(mutations.get("m-d")?.operation).toBe("delete")
    // Payload is carried verbatim.
    expect(JSON.parse(mutations.get("m-p")!.payloadJson).status).toBe("draft")
  })

  it("counts collection/writing-collection mutations as retained, never dropped", async () => {
    const { sink } = makeSink()
    const collectionMutation: SyncMutation = {
      id: "mc-1",
      entity_kind: "collection",
      entity_id: "col-1",
      entity_key: "collection:col-1",
      operation: "upsert",
      payload: { name: "Coll", description: null, visibility: "private", updated_at: "2026-01-01T00:00:00.000Z" },
      created_at: 1,
      attempts: 0,
    }
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", { mutations: [collectionMutation] }),
      }),
      sink,
    })

    expect(summary.retainedCollectionMutationCount).toBe(1)
  })

  it("emits a single fan-out signal for the whole batch", async () => {
    const { sink } = makeSink()
    const onBatchComplete = vi.fn()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [writing({ id: "x", canonical_path: "/root/x.md" }), writing({ id: "y", canonical_path: "/root/y.md" })],
        }),
      }),
      sink,
      onBatchComplete,
    })

    expect(onBatchComplete).toHaveBeenCalledTimes(1)
    expect(onBatchComplete).toHaveBeenCalledWith(["x", "y"])
    expect(summary.catalogChangesEmitted).toBe(1)
  })

  it("resumes idempotently after an interrupted checkpoint without duplicating mutations", async () => {
    const checkpoint = memoryCheckpoint()
    const scopeData = reader({
      anonymous: snapshot("anonymous", {
        writings: [
          writing({ id: "one", canonical_path: "/root/one.md" }),
          writing({ id: "two", canonical_path: "/root/two.md" }),
          writing({ id: "three", canonical_path: "/root/three.md" }),
        ],
        mutations: [
          mutation({ id: "mu-one", entity_id: "one" }),
          mutation({ id: "mu-two", entity_id: "two" }),
          mutation({ id: "mu-three", entity_id: "three" }),
        ],
      }),
    })

    // First run: sink fails after two commits, simulating a crash mid-migration.
    const first = makeSink()
    let commits = 0
    const flakySink: CatalogMigrationSink = {
      async commit(input) {
        commits += 1
        if (commits === 3) throw new Error("simulated interruption")
        return first.sink.commit(input)
      },
    }
    await expect(
      migrateIndexedDbToSqlite({ reader: scopeData, sink: flakySink, checkpoint }),
    ).rejects.toThrow("simulated interruption")
    expect(checkpoint.current?.status).toBe("failed")
    expect(first.documents.size).toBe(2)

    // Second run resumes: already-committed ids are skipped, no mutation repeats.
    const commitCounts = new Map<string, number>()
    const resumeSink: CatalogMigrationSink = {
      async commit(input) {
        commitCounts.set(input.document.id, (commitCounts.get(input.document.id) ?? 0) + 1)
        return first.sink.commit(input)
      },
    }
    const summary = await migrateIndexedDbToSqlite({ reader: scopeData, sink: resumeSink, checkpoint })

    expect(summary.status).toBe("completed")
    expect([...first.documents.keys()].sort()).toEqual(["one", "three", "two"])
    expect(first.mutations.size).toBe(3)
    // The two already-committed documents are not re-committed on resume.
    expect(commitCounts.get("one")).toBeUndefined()
    expect(commitCounts.get("three")).toBe(1)
  })

  it("does not duplicate conflicts when resuming after an interruption", async () => {
    const checkpoint = memoryCheckpoint()
    const data = reader({
      anonymous: snapshot("anonymous", {
        writings: [
          writing({ id: "dup", version: 1, body_text: "a", canonical_path: "/root/a.md" }),
          writing({ id: "other", canonical_path: "/root/o.md" }),
        ],
      }),
      "user-1": snapshot("user-1", {
        writings: [writing({ id: "dup", version: 3, body_text: "b", canonical_path: "/root/b.md" })],
      }),
    })

    // First run fails after the winning "dup" row commits, leaving a checkpoint
    // that already carries the UUID conflict.
    const first = makeSink()
    let commits = 0
    const flakySink: CatalogMigrationSink = {
      async commit(input) {
        commits += 1
        if (commits === 2) throw new Error("interrupted")
        return first.sink.commit(input)
      },
    }
    await expect(migrateIndexedDbToSqlite({ reader: data, sink: flakySink, checkpoint })).rejects.toThrow("interrupted")
    expect(checkpoint.current?.conflicts.filter((c) => c.kind === "uuid")).toHaveLength(1)

    // Resume re-harvests and re-detects the same divergence but does not append it again.
    const summary = await migrateIndexedDbToSqlite({ reader: data, sink: first.sink, checkpoint })
    expect(summary.conflicts.filter((c) => c.kind === "uuid")).toHaveLength(1)
  })

  it("does nothing when a completed checkpoint already exists", async () => {
    const checkpoint = memoryCheckpoint()
    const first = makeSink()
    await migrateIndexedDbToSqlite({
      reader: reader({ anonymous: snapshot("anonymous", { writings: [writing({ id: "z", canonical_path: "/root/z.md" })] }) }),
      sink: first.sink,
      checkpoint,
    })
    expect(checkpoint.current?.status).toBe("completed")

    const second = makeSink()
    const summary = await migrateIndexedDbToSqlite({
      reader: reader({ anonymous: snapshot("anonymous", { writings: [writing({ id: "z", canonical_path: "/root/z.md" })] }) }),
      sink: second.sink,
      checkpoint,
    })
    expect(second.documents.size).toBe(0)
    expect(summary.status).toBe("completed")
  })

  it("prefers the manifest UUID when reconciling a bound record", async () => {
    const { sink, documents, bindings } = makeSink()
    await migrateIndexedDbToSqlite({
      reader: reader({
        anonymous: snapshot("anonymous", {
          writings: [writing({ id: "indexeddb-id", canonical_path: "/root/m.md" })],
        }),
      }),
      sink,
      reconciler: {
        async resolveDocumentId({ canonicalPath }) {
          return canonicalPath === "/root/m.md" ? "manifest-id" : "indexeddb-id"
        },
      },
    })

    expect(documents.has("manifest-id")).toBe(true)
    expect(documents.has("indexeddb-id")).toBe(false)
    expect(bindings.get("/root/m.md")).toBe("manifest-id")
  })
})
