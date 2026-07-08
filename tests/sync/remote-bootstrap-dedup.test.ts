import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import {
  hydrateLocalWritingsFromRemote,
  invalidateWebWritingsHydrationFreshness,
} from "@/lib/sync/remote-bootstrap"

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

    // Single-flight collapses the 4 callers into one hydration. That hydration
    // is two-phase (manifest + selective body fetch), so it issues exactly 2
    // network requests — not 8.
    expect(fetchCount).toBe(2)
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

    // First hydration on an empty local DB is two-phase: manifest + bodies.
    await hydrateLocalWritingsFromRemote()
    expect(fetchCount).toBe(2)

    // A sequential caller inside the freshness window reuses local state
    // without touching the network (Desk mounting after bootstrap).
    await hydrateLocalWritingsFromRemote()
    expect(fetchCount).toBe(2)

    // Explicit refresh flows (force) invalidate the window and fetch again.
    // Nothing changed remotely now, so phase 2 is skipped — only the manifest
    // request is issued (the whole point of incremental hydration).
    invalidateWebWritingsHydrationFreshness()
    await hydrateLocalWritingsFromRemote()
    expect(fetchCount).toBe(3)

  })

  it("chunks phase-2 body fetches so no request exceeds the API batch limit", async () => {
    const total = 250

    const makeRemote = (index: number) => ({
      id: `writing-${index}`,
      author_id: "user-1",
      title: `Remote ${index}`,
      slug: `remote-${index}`,
      status: "draft",
      visibility: "private",
      parent_id: null,
      correspondence_id: null,
      version: 1,
      sync_status: "synced",
      deleted_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
      content_hash: `hash-${index}`,
    })

    const manifest = Array.from({ length: total }, (_, index) => makeRemote(index))
    const idsRequests: string[][] = []

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)

        let data: unknown
        if (url.includes("fields=manifest")) {
          data = manifest
        } else {
          const idsParam = decodeURIComponent(url.split("ids=")[1] ?? "")
          const ids = idsParam.split(",").filter(Boolean)
          idsRequests.push(ids)
          data = manifest
            .filter((record) => ids.includes(record.id))
            .map((record) => ({
              ...record,
              body_json: { type: "doc", content: [] },
              body_text: `Body ${record.id}`,
            }))
        }

        return Promise.resolve(
          new Response(JSON.stringify({ data, error: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }),
    )

    const applied = await hydrateLocalWritingsFromRemote()

    expect(applied).toBe(total)
    // 250 changed ids with a 200-id API cap ⇒ two body batches (200 + 50).
    expect(idsRequests).toHaveLength(2)
    expect(idsRequests[0]).toHaveLength(200)
    expect(idsRequests[1]).toHaveLength(50)
  })

  it("does not repeatedly fetch a body that was downloaded but rejected by local merge policy", async () => {
    await localDB.writings.save(makeLocalWriting({
      version: 3,
      updated_at: "2026-01-03T00:00:00.000Z",
      content_hash: "local-hash",
      body_text: "Local version wins",
    }))

    let manifestHash = "remote-hash-a"
    let manifestUpdatedAt = "2026-01-04T00:00:00.000Z"
    let bodyFetchCount = 0

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        const remote = {
          id: "writing-1",
          author_id: "user-1",
          title: "Remote Title",
          slug: "remote-title",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: manifestUpdatedAt,
          content_hash: manifestHash,
        }

        if (!url.includes("fields=manifest")) {
          bodyFetchCount += 1
        }

        const data = url.includes("fields=manifest")
          ? [remote]
          : [{ ...remote, body_json: { type: "doc", content: [] }, body_text: "Remote body" }]

        return Promise.resolve(
          new Response(JSON.stringify({ data, error: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }),
    )

    expect(await hydrateLocalWritingsFromRemote()).toBe(0)
    expect(bodyFetchCount).toBe(1)
    expect((await localDB.writings.get("writing-1"))?.body_text).toBe("Local version wins")
    expect((await localDB.writings.get("writing-1"))?.remote_body_rejection).toEqual({
      content_hash: "remote-hash-a",
      version: 2,
      updated_at: "2026-01-04T00:00:00.000Z",
    })

    invalidateWebWritingsHydrationFreshness()
    expect(await hydrateLocalWritingsFromRemote()).toBe(0)
    expect(bodyFetchCount).toBe(1)

    manifestHash = "remote-hash-b"
    manifestUpdatedAt = "2026-01-05T00:00:00.000Z"
    invalidateWebWritingsHydrationFreshness()
    expect(await hydrateLocalWritingsFromRemote()).toBe(0)
    expect(bodyFetchCount).toBe(2)

    vi.unstubAllGlobals()
  })
})
