import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
  setLocalDBScope(`test-dedup-${crypto.randomUUID()}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("hydrateLocalWritingsFromRemote — in-flight dedup", () => {
  it("deduplicates 4 concurrent invocations into a single fetch", async () => {
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

    let fetchCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify(listResponse), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            )
          }, 50)
        })
      }),
    )

    const p1 = hydrateLocalWritingsFromRemote()
    const p2 = hydrateLocalWritingsFromRemote()
    const p3 = hydrateLocalWritingsFromRemote()
    const p4 = hydrateLocalWritingsFromRemote()

    const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4])

    expect(fetchCount).toBe(1)
    expect(r1).toBe(1)
    expect(r2).toBe(1)
    expect(r3).toBe(1)
    expect(r4).toBe(1)

  })

  it("propagates errors to all concurrent callers", async () => {
    let fetchCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1
        return new Promise<Response>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Network failure"))
          }, 50)
        })
      }),
    )

    const p1 = hydrateLocalWritingsFromRemote()
    const p2 = hydrateLocalWritingsFromRemote()
    const p3 = hydrateLocalWritingsFromRemote()
    const p4 = hydrateLocalWritingsFromRemote()

    await expect(Promise.all([p1, p2, p3, p4])).rejects.toThrow("Network failure")
    expect(fetchCount).toBe(1)

  })

  it("releases the in-flight promise so a subsequent call triggers a new fetch", async () => {
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

    let fetchCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1
        return Promise.resolve(
          new Response(JSON.stringify(listResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }),
    )

    await hydrateLocalWritingsFromRemote()
    expect(fetchCount).toBe(1)

    await hydrateLocalWritingsFromRemote()
    expect(fetchCount).toBe(2)

  })
})
