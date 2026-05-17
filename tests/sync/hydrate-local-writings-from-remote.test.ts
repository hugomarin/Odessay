import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap"

const makeLocalWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Local Title",
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] },
  body_text: "Hello world",
  slug: "local-title",
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 2,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  local_updated_at: 1735689600000,
  ...overrides,
})

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = globalThis
  setLocalDBScope(`test-hydrate-${crypto.randomUUID()}`)
})

describe("hydrateLocalWritingsFromRemote — list response integration", () => {
  it("preserves local body when remote list response omits body fields", async () => {
    const existing = makeLocalWriting()
    await localDB.writings.save(existing)

    const listResponse = {
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Remote Title",
          slug: "remote-title",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 3,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-03T00:00:00.000Z",
        },
      ],
      error: null,
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(listResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    )

    const applied = await hydrateLocalWritingsFromRemote()
    expect(applied).toBe(1)

    const stored = await localDB.writings.get("writing-1")
    expect(stored).not.toBeNull()
    expect(stored?.title).toBe("Remote Title")
    expect(stored?.version).toBe(3)
    // Body must be preserved from the local writing
    expect(stored?.body_text).toBe("Hello world")
    expect(stored?.body_json).toEqual(existing.body_json)

    vi.unstubAllGlobals()
  })

  it("applies list response for a new writing without local body", async () => {
    const listResponse = {
      data: [
        {
          id: "writing-new",
          author_id: "user-1",
          title: "New Writing",
          slug: "new-writing",
          status: "done",
          visibility: "public",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(listResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    )

    const applied = await hydrateLocalWritingsFromRemote()
    expect(applied).toBe(1)

    const stored = await localDB.writings.get("writing-new")
    expect(stored).not.toBeNull()
    expect(stored?.title).toBe("New Writing")
    expect(stored?.status).toBe("done")
    // New writing gets empty body defaults
    expect(stored?.body_text).toBe("")
    expect(stored?.body_json).toEqual({ type: "doc", content: [] })

    vi.unstubAllGlobals()
  })

  it("does not overwrite local body when remote has older version", async () => {
    const existing = makeLocalWriting({ version: 5 })
    await localDB.writings.save(existing)

    const listResponse = {
      data: [
        {
          id: "writing-1",
          author_id: "user-1",
          title: "Stale Title",
          slug: "stale-title",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 3,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(listResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    )

    const applied = await hydrateLocalWritingsFromRemote()
    expect(applied).toBe(0)

    const stored = await localDB.writings.get("writing-1")
    expect(stored?.title).toBe("Local Title")
    expect(stored?.body_text).toBe("Hello world")

    vi.unstubAllGlobals()
  })
})
