import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { webSyncService } from "@/lib/services/web-sync-service"

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
  setLocalDBScope(`test-sync-hydration-${crypto.randomUUID()}`)
})

describe("sync hydration through SyncService", () => {
  it("does not create duplicate requests when hydrateWritings is called concurrently", async () => {
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

    const p1 = webSyncService.hydrateWritings()
    const p2 = webSyncService.hydrateWritings()
    const p3 = webSyncService.hydrateWritings()

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(fetchCount).toBe(1)
    expect(r1.data?.appliedCount).toBe(1)
    expect(r2.data?.appliedCount).toBe(1)
    expect(r3.data?.appliedCount).toBe(1)
  })

  it("does not create duplicate requests when hydrateCollections is called concurrently", async () => {
    const payload = {
      data: {
        collections: [
          {
            id: "collection-1",
            owner_id: "user-1",
            name: "Remote Collection",
            description: null,
            visibility: "private",
            created_at: "2026-04-21T00:00:00.000Z",
            updated_at: "2026-04-21T00:00:00.000Z",
          },
        ],
        writingCollections: [],
      },
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
              new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            )
          }, 50)
        })
      }),
    )

    const p1 = webSyncService.hydrateCollections()
    const p2 = webSyncService.hydrateCollections()
    const p3 = webSyncService.hydrateCollections()

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(fetchCount).toBe(1)
    expect(r1.data?.appliedCount).toBe(1)
    expect(r2.data?.appliedCount).toBe(1)
    expect(r3.data?.appliedCount).toBe(1)
  })

  it("does not create duplicate requests when hydrateWriting is called concurrently for the same id", async () => {
    const local = makeLocalWriting({
      body_json: { type: "doc", content: [] },
      body_text: "",
      lifecycle: "server-confirmed",
      sync_status: "synced",
    })
    await localDB.writings.save(local)

    const payload = {
      data: {
        id: "writing-1",
        author_id: "user-1",
        title: "Remote Title",
        body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Remote body" }] }] },
        body_text: "Remote body",
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
              new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            )
          }, 50)
        })
      }),
    )

    const p1 = webSyncService.hydrateWriting({ writingId: "writing-1" })
    const p2 = webSyncService.hydrateWriting({ writingId: "writing-1" })
    const p3 = webSyncService.hydrateWriting({ writingId: "writing-1" })

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(fetchCount).toBe(1)
    expect(r1.data?.hydrated).toBe(true)
    expect(r2.data?.hydrated).toBe(true)
    expect(r3.data?.hydrated).toBe(true)
  })

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

    const result = await webSyncService.hydrateWritings()
    expect(result.data?.appliedCount).toBe(1)

    const stored = await localDB.writings.get("writing-1")
    expect(stored?.body_text).toBe("Hello world")
    expect(stored?.body_json).toEqual(existing.body_json)
  })
})
