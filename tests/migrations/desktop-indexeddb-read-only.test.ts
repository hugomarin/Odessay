import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LocalDBReadOnlyError,
  isLocalDBReadOnly,
  listLocalDBScopes,
  localDB,
  readScopeSnapshot,
  setLocalDBReadOnly,
  setLocalDBScope,
  subscribeToLocalDBReadOnlyBlocks,
} from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

function writing(id: string): LocalWriting {
  return {
    id,
    title: id,
    body_json: { type: "doc" },
    body_text: id,
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "pending",
    lifecycle: "local-only",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    local_updated_at: 1,
  }
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis)
})

afterEach(() => {
  setLocalDBReadOnly(false)
  setLocalDBScope("anonymous")
  vi.unstubAllGlobals()
})

describe("ODE-376 · desktop IndexedDB read-only compatibility latch", () => {
  it("web writes remain functional while the latch is off (requirement 9)", async () => {
    expect(isLocalDBReadOnly()).toBe(false)
    await localDB.writings.save(writing("web-doc"))
    expect(await localDB.writings.get("web-doc")).not.toBeNull()
  })

  it("blocks new desktop writes and emits telemetry once the latch is on (requirement 7)", async () => {
    const blocked: string[] = []
    const unsubscribe = subscribeToLocalDBReadOnlyBlocks((event) => blocked.push(event.operation))
    setLocalDBReadOnly(true)

    await expect(localDB.writings.save(writing("blocked-doc"))).rejects.toBeInstanceOf(LocalDBReadOnlyError)
    expect(blocked).toContain("writings.save")

    unsubscribe()
    setLocalDBReadOnly(false)
    // Turning the latch back off restores writability.
    await localDB.writings.save(writing("after-doc"))
    expect(await localDB.writings.get("after-doc")).not.toBeNull()
  })

  it("enumerates every scope independent of the active session (requirement 1)", async () => {
    setLocalDBScope("anonymous")
    await localDB.writings.save(writing("anon-doc"))
    setLocalDBScope("user-42")
    await localDB.writings.save(writing("user-doc"))

    // Switch back to anonymous — enumeration still reports every scope, so local
    // membership is not partitioned by the active auth session.
    setLocalDBScope("anonymous")
    const scopes = await listLocalDBScopes()
    expect(scopes).toContain("anonymous")
    expect(scopes).toContain("user-42")
  })

  it("reads a scope snapshot without changing the active scope (logout membership stable)", async () => {
    setLocalDBScope("user-42")
    await localDB.writings.save(writing("user-only"))
    setLocalDBScope("anonymous")

    const snapshot = await readScopeSnapshot("user-42")
    expect(snapshot.scope).toBe("user-42")
    expect(snapshot.writings.map((w) => w.id)).toContain("user-only")
  })
})
