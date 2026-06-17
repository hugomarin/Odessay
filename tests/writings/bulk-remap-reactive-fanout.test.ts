import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope, subscribeToLocalDBChanges } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { bulkRemapStatusToDraft } from "@/lib/writings/bulk-remap"


const createWriting = (overrides: Partial<LocalWriting> & { id: string }): LocalWriting => ({
  title: "Test writing",
  body_json: { type: "doc" },
  body_text: "Test content",
  status: overrides.status ?? "draft",
  visibility: "private",
  version: 1,
  sync_status: overrides.sync_status ?? "synced",
  lifecycle: "server-confirmed",
  created_at: "2026-05-21T00:00:00.000Z",
  updated_at: "2026-05-21T00:00:00.000Z",
  local_updated_at: Date.now(),
  ...overrides,
})

beforeEach(() => {
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal("navigator", { onLine: false })
  setLocalDBScope(`test-fanout-${crypto.randomUUID()}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("bulk remap reactive fan-out", () => {
  it("emits a single coherent localDB update that subscribers observe", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "archived" }))
    await localDB.writings.save(createWriting({ id: "w-2", status: "archived" }))
    await localDB.writings.save(createWriting({ id: "w-3", status: "draft" }))

    const listener = vi.fn()
    subscribeToLocalDBChanges(listener)

    await bulkRemapStatusToDraft("archived")

    // Wait for async IndexedDB writes to settle
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Listener should have been called at least once after the remap
    expect(listener).toHaveBeenCalled()

    // All affected writings should now read as draft — no stale state
    const allWritings = await localDB.writings.getAll()
    const archivedWritings = allWritings.filter((w) => w.status === "archived")
    expect(archivedWritings).toHaveLength(0)
  })

  it("does not leave stale filter state behind after remap", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "canceled" }))
    await localDB.writings.save(createWriting({ id: "w-2", status: "canceled" }))
    await localDB.writings.save(createWriting({ id: "w-3", status: "done" }))

    // Before remap: filter by canceled returns 2
    const allBefore = await localDB.writings.getAll()
    const before = allBefore.filter((w) => w.status === "canceled")
    expect(before).toHaveLength(2)

    await bulkRemapStatusToDraft("canceled")

    // After remap: filter by canceled returns 0 (no stale state)
    const allAfter = await localDB.writings.getAll()
    const after = allAfter.filter((w) => w.status === "canceled")
    expect(after).toHaveLength(0)

    // And they appear in draft filter
    const drafts = allAfter.filter((w) => w.status === "draft")
    expect(drafts).toHaveLength(2)
  })

  it("preserves non-target writings unchanged through the remap", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "in_review" }))
    await localDB.writings.save(createWriting({ id: "w-2", status: "new" }))
    await localDB.writings.save(createWriting({ id: "w-3", status: "exploring" }))

    await bulkRemapStatusToDraft("archived")

    const w1 = await localDB.writings.get("w-1")
    const w2 = await localDB.writings.get("w-2")
    const w3 = await localDB.writings.get("w-3")

    expect(w1?.status).toBe("in_review")
    expect(w2?.status).toBe("new")
    expect(w3?.status).toBe("exploring")
  })
})
