/**
 * SYNC-03 — a failed sync attempt must never leave local state worse off
 * than before the attempt.
 *
 * Real SyncWorker.flush() -> real localDB (fake-indexeddb) -> only the
 * network transport (upsertWriting) is faked, to simulate a cloud/network
 * failure. Everything else — the sync queue, the writing row, the retry
 * bookkeeping — is the real, unmodified production code.
 *
 * Real bug found and fixed: `processMutation` optimistically writes
 * `lifecycle: "syncing"` to the local writing *before* the network call
 * (worker.ts), but its terminal-failure branch (retries exhausted) never
 * reverted it. Since `WritingLifecycle` only has three values
 * (local-only/syncing/server-confirmed), and other real call sites
 * (`hydrateCorrectionBlocks`) gate on it never being local-only/syncing,
 * a document that ever exhausts its sync retries got silently and
 * permanently stuck as "syncing" with no further attempts scheduled.
 *
 * See workflow/quality/capability-integration-map.md (SYNC-03).
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEntityKey, localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { SyncWorker } from "@/lib/sync/worker"
import { MAX_ACTIVE_RETRIES } from "@/lib/sync/retry"

const WRITING_ID = "writing-sync03"

const makeLocalWriting = (): LocalWriting => ({
  id: WRITING_ID,
  body_json: { type: "doc", content: [{ type: "paragraph" }] },
  body_text: "Content that must survive a failed sync attempt.",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: "pending",
  lifecycle: "local-only",
  created_at: "2026-09-22T00:00:00.000Z",
  updated_at: "2026-09-22T00:00:00.000Z",
  local_updated_at: Date.now(),
})

const failingTransport = () => ({
  upsertWriting: vi.fn(async () => {
    throw new Error("network down")
  }),
  deleteWriting: vi.fn(async () => undefined),
  upsertCollection: vi.fn(async () => undefined),
  deleteCollection: vi.fn(async () => undefined),
  setWritingCollections: vi.fn(async () => undefined),
})

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  setLocalDBScope(`sync-03-${crypto.randomUUID()}`)
})

describe("SYNC-03 — sync failure preserves local content", () => {
  it("a terminally failed sync leaves body content untouched and reverts lifecycle instead of sticking on 'syncing'", async () => {
    const original = makeLocalWriting()
    await localDB.writings.save(original)

    await localDB.syncQueue.enqueue({
      id: "mutation-sync03",
      entity_kind: "writing",
      entity_id: WRITING_ID,
      entity_key: createEntityKey("writing", WRITING_ID),
      operation: "upsert",
      payload: {
        body_json: original.body_json,
        body_text: original.body_text,
        status: "draft",
        artifact_type: "general",
        visibility: "private",
        version: 1,
        updated_at: original.updated_at,
      },
      created_at: 1,
      // Already at the retry ceiling: the next failure is terminal
      // (canRetryMutation(attempts + 1) is false), so this single flush()
      // exercises the "no more retries coming" branch directly.
      attempts: MAX_ACTIVE_RETRIES,
    })

    const worker = new SyncWorker({
      localDb: localDB,
      isOnline: () => true,
      transport: failingTransport(),
    })

    await worker.flush()

    const reloaded = await localDB.writings.get(WRITING_ID)
    expect(reloaded?.body_json).toEqual(original.body_json)
    expect(reloaded?.body_text).toBe(original.body_text)
    expect(reloaded?.lifecycle).toBe("local-only")

    const mutation = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(mutation?.attempts).toBe(MAX_ACTIVE_RETRIES + 1)
    expect(mutation?.next_retry_at).toBe(Number.MAX_SAFE_INTEGER)
  })

  it("a retryable failure (attempts below the ceiling) may leave lifecycle as 'syncing' while a retry is still scheduled", async () => {
    const original = makeLocalWriting()
    await localDB.writings.save(original)

    await localDB.syncQueue.enqueue({
      id: "mutation-sync03-retryable",
      entity_kind: "writing",
      entity_id: WRITING_ID,
      entity_key: createEntityKey("writing", WRITING_ID),
      operation: "upsert",
      payload: {
        body_json: original.body_json,
        body_text: original.body_text,
        status: "draft",
        artifact_type: "general",
        visibility: "private",
        version: 1,
        updated_at: original.updated_at,
      },
      created_at: 1,
      attempts: 0,
    })

    const worker = new SyncWorker({
      localDb: localDB,
      isOnline: () => true,
      transport: failingTransport(),
    })

    await worker.flush()

    const reloaded = await localDB.writings.get(WRITING_ID)
    expect(reloaded?.body_json).toEqual(original.body_json)
    expect(reloaded?.body_text).toBe(original.body_text)

    const mutation = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(mutation?.attempts).toBe(1)
    expect(mutation?.next_retry_at).toBeGreaterThan(Date.now())
  })
})
