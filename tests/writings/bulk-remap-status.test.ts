import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
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
  setLocalDBScope(`test-bulk-remap-${Date.now()}`)
})

describe("bulkRemapStatusToDraft", () => {
  it("remaps all writings with the target status to draft", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "archived" }))
    await localDB.writings.save(createWriting({ id: "w-2", status: "archived" }))
    await localDB.writings.save(createWriting({ id: "w-3", status: "draft" }))

    const result = await bulkRemapStatusToDraft("archived")

    expect(result.affectedCount).toBe(2)
    expect(result.errors).toHaveLength(0)

    const w1 = await localDB.writings.get("w-1")
    const w2 = await localDB.writings.get("w-2")
    const w3 = await localDB.writings.get("w-3")

    expect(w1?.status).toBe("draft")
    expect(w2?.status).toBe("draft")
    expect(w3?.status).toBe("draft")
  })

  it("ignores deleted writings", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "canceled", sync_status: "deleted" }))
    await localDB.writings.save(createWriting({ id: "w-2", status: "canceled", sync_status: "synced" }))

    const result = await bulkRemapStatusToDraft("canceled")

    expect(result.affectedCount).toBe(1)

    const w1 = await localDB.writings.get("w-1")
    const w2 = await localDB.writings.get("w-2")

    expect(w1?.status).toBe("canceled")
    expect(w2?.status).toBe("draft")
  })

  it("ignores writings with other statuses", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "in_review" }))
    await localDB.writings.save(createWriting({ id: "w-2", status: "done" }))

    const result = await bulkRemapStatusToDraft("archived")

    expect(result.affectedCount).toBe(0)

    const w1 = await localDB.writings.get("w-1")
    const w2 = await localDB.writings.get("w-2")

    expect(w1?.status).toBe("in_review")
    expect(w2?.status).toBe("done")
  })

  it("increments version and sets pending sync status", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "archived", version: 5 }))

    const result = await bulkRemapStatusToDraft("archived")

    expect(result.affectedCount).toBe(1)

    const w1 = await localDB.writings.get("w-1")
    expect(w1?.status).toBe("draft")
    expect(w1?.version).toBe(6)
    expect(w1?.sync_status).toBe("pending")
  })

  it("returns affected count of zero when no writings match", async () => {
    await localDB.writings.save(createWriting({ id: "w-1", status: "draft" }))

    const result = await bulkRemapStatusToDraft("archived")

    expect(result.affectedCount).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})
