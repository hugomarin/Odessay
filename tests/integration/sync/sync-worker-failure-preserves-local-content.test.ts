/**
 * SYNC-03 — a failed sync attempt must never leave local state worse off
 * than before the attempt.
 *
 * Real SyncWorker.flush() -> real localDB (fake-indexeddb) -> only the
 * network transport (upsertWriting) is faked, to simulate a cloud/network
 * failure. Everything else — the sync queue, the writing row, the retry
 * bookkeeping — is the real, unmodified production code.
 *
 * Real bug found and fixed, in two passes:
 *
 * 1. `processMutation` optimistically writes `lifecycle: "syncing"` to the
 *    local writing *before* the network call, but its terminal-failure
 *    branch (retries exhausted) never reverted it. Since `WritingLifecycle`
 *    only has three values (local-only/syncing/server-confirmed), and other
 *    real call sites (`hydrateCorrectionBlocks`) gate on it never being
 *    local-only/syncing, a document that exhausted its sync retries got
 *    silently and permanently stuck as "syncing".
 * 2. The first fix only reverted lifecycle in the terminal branch, which
 *    missed the real multi-retry path: a *retryable* failure left lifecycle
 *    on "syncing" too, so the next attempt's own pre-attempt snapshot
 *    (`localWriting`, captured fresh each call) already read "syncing" —
 *    the terminal branch's `!== "syncing"` guard then never fired either,
 *    and the bug survived the whole retry sequence. Caught in review by a
 *    test that drives the real sequence (seed attempts: 0, run flush()
 *    repeatedly through the actual retry ceiling) instead of seeding a
 *    mutation whose `attempts` field jumps straight to the terminal
 *    boundary, which starts from a lifecycle never touched by a prior
 *    failure and so cannot see this cascade. Fixed by reverting on every
 *    failure, retryable or terminal: "syncing" now means "a remote attempt
 *    is actively in flight," not "a retry is scheduled" — that's already
 *    covered by sync_status/the queue's own attempts/next_retry_at and the
 *    "retrying" event.
 *
 * See workflow/quality/capability-integration-map.md (SYNC-03).
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEntityKey, localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting, WritingLifecycle } from "@/lib/local-db/schema"
import { SyncWorker } from "@/lib/sync/worker"
import { MAX_ACTIVE_RETRIES } from "@/lib/sync/retry"

const WRITING_ID = "writing-sync03"
const MUTATION_ID = "mutation-sync03"

const makeLocalWriting = (lifecycle: WritingLifecycle = "local-only"): LocalWriting => ({
  id: WRITING_ID,
  body_json: { type: "doc", content: [{ type: "paragraph" }] },
  body_text: "Content that must survive a failed sync attempt.",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: lifecycle === "server-confirmed" ? "synced" : "pending",
  lifecycle,
  created_at: "2026-09-22T00:00:00.000Z",
  updated_at: "2026-09-22T00:00:00.000Z",
  local_updated_at: Date.now(),
})

const enqueueMutationFor = (writing: LocalWriting, attempts: number) =>
  localDB.syncQueue.enqueue({
    id: MUTATION_ID,
    entity_kind: "writing",
    entity_id: WRITING_ID,
    entity_key: createEntityKey("writing", WRITING_ID),
    operation: "upsert",
    payload: {
      body_json: writing.body_json,
      body_text: writing.body_text,
      status: "draft",
      artifact_type: "general",
      visibility: "private",
      version: 1,
      updated_at: writing.updated_at,
    },
    created_at: 1,
    attempts,
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

const makeWorker = () =>
  new SyncWorker({
    localDb: localDB,
    isOnline: () => true,
    transport: failingTransport(),
  })

/**
 * Simulates "enough time has passed" without fake timers, which hang when
 * combined with fake-indexeddb's own internal scheduling: re-enqueues the
 * mutation's current state with `next_retry_at` reset to 0 so the next
 * flush() sees it as due, exactly as a real clock tick eventually would.
 */
const makeMutationImmediatelyDue = async () => {
  const current = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
  if (current) {
    await localDB.syncQueue.enqueue({ ...current, next_retry_at: 0 })
  }
}

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
  it("a single retryable failure reverts lifecycle immediately instead of leaving it on 'syncing' until retries exhaust", async () => {
    const original = makeLocalWriting("local-only")
    await localDB.writings.save(original)
    await enqueueMutationFor(original, 0)

    await makeWorker().flush()

    const reloaded = await localDB.writings.get(WRITING_ID)
    expect(reloaded?.body_json).toEqual(original.body_json)
    expect(reloaded?.body_text).toBe(original.body_text)
    expect(reloaded?.lifecycle).toBe("local-only")

    const mutation = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(mutation?.attempts).toBe(1)
    expect(mutation?.next_retry_at).toBeGreaterThan(Date.now())
  })

  it("a full retry sequence through the real terminal boundary never leaves lifecycle stuck on 'syncing'", async () => {
    const original = makeLocalWriting("local-only")
    await localDB.writings.save(original)
    await enqueueMutationFor(original, 0)

    const worker = makeWorker()

    for (let attempt = 0; attempt < MAX_ACTIVE_RETRIES; attempt++) {
      await makeMutationImmediatelyDue()
      await worker.flush()

      const reloaded = await localDB.writings.get(WRITING_ID)
      expect(reloaded?.body_json).toEqual(original.body_json)
      expect(reloaded?.body_text).toBe(original.body_text)
      // The point of this test: every single failure in the sequence — not
      // just the last one — must leave lifecycle back at its stable
      // pre-sync value, never carried over as "syncing" into the next
      // attempt's own pre-attempt snapshot.
      expect(reloaded?.lifecycle).toBe("local-only")
    }

    const finalMutation = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(finalMutation?.next_retry_at).toBe(Number.MAX_SAFE_INTEGER)
  })

  it("reverts to 'server-confirmed' (not 'local-only') when a failed re-sync attempt hits an already-synced document", async () => {
    const original = makeLocalWriting("server-confirmed")
    await localDB.writings.save(original)
    await enqueueMutationFor(original, 0)

    await makeWorker().flush()

    const reloaded = await localDB.writings.get(WRITING_ID)
    expect(reloaded?.lifecycle).toBe("server-confirmed")
  })

  it("a mutation seeded directly at the terminal boundary is still handled correctly on its own", async () => {
    const original = makeLocalWriting("local-only")
    await localDB.writings.save(original)
    // canRetryMutation(attempts + 1) is false starting at attempts + 1 ===
    // MAX_ACTIVE_RETRIES, i.e. attempts === MAX_ACTIVE_RETRIES - 1 — the
    // precise boundary, not an approximation.
    await enqueueMutationFor(original, MAX_ACTIVE_RETRIES - 1)

    await makeWorker().flush()

    const reloaded = await localDB.writings.get(WRITING_ID)
    expect(reloaded?.body_json).toEqual(original.body_json)
    expect(reloaded?.body_text).toBe(original.body_text)
    expect(reloaded?.lifecycle).toBe("local-only")

    const mutation = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(mutation?.attempts).toBe(MAX_ACTIVE_RETRIES)
    expect(mutation?.next_retry_at).toBe(Number.MAX_SAFE_INTEGER)
  })
})
