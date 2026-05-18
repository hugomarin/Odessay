import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import {
  hydrateLocalWritingFromRemote,
  needsBodyHydration,
} from "@/lib/sync/remote-bootstrap"

const baseLocal = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Untitled",
  body_json: { type: "doc", content: [] },
  body_text: "",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  local_updated_at: 1735689600000,
  ...overrides,
})

const detailResponse = (overrides: Partial<LocalWriting> = {}) => ({
  data: {
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
    updated_at: "2026-01-02T00:00:00.000Z",
    body_json: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello remote" }] },
      ],
    },
    body_text: "Hello remote",
    ...overrides,
  },
  error: null,
})

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = globalThis
  setLocalDBScope(`test-lazy-body-${crypto.randomUUID()}`)
  vi.unstubAllGlobals()
})

describe("needsBodyHydration — entry-path predicate", () => {
  it("hydrates when local writing is absent (URL directa, primer paint)", () => {
    expect(needsBodyHydration(null)).toBe(true)
  })

  it("hydrates a list-only entry written by the Desk bootstrap (click en fila del Desk)", () => {
    const listOnly = baseLocal({ body_text: "", body_json: { type: "doc", content: [] } })
    expect(needsBodyHydration(listOnly)).toBe(true)
  })

  it("hydrates the active tab switch when its body is still empty (navegación entre tabs)", () => {
    const tabSwitch = baseLocal({
      id: "writing-tab-2",
      body_text: "",
      body_json: { type: "doc", content: [] },
    })
    expect(needsBodyHydration(tabSwitch)).toBe(true)
  })

  it("hydrates each child in a correspondence independently (apertura desde correspondencia)", () => {
    const child = baseLocal({
      id: "writing-child",
      parent_id: "writing-parent",
      correspondence_id: "corr-1",
      body_text: "",
      body_json: { type: "doc", content: [] },
    })
    expect(needsBodyHydration(child)).toBe(true)
  })

  it("does not hydrate when the body is already present locally", () => {
    const present = baseLocal({
      body_text: "Hello",
      body_json: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        ],
      },
    })
    expect(needsBodyHydration(present)).toBe(false)
  })

  it("does not hydrate a brand-new local-only writing", () => {
    const localOnly = baseLocal({ lifecycle: "local-only", sync_status: "synced" })
    expect(needsBodyHydration(localOnly)).toBe(false)
  })

  it("does not hydrate over pending or failed local edits", () => {
    expect(needsBodyHydration(baseLocal({ sync_status: "pending" }))).toBe(false)
    expect(needsBodyHydration(baseLocal({ sync_status: "failed" }))).toBe(false)
  })
})

describe("hydrateLocalWritingFromRemote — fetch + dedup", () => {
  it("fetches the writing detail and persists the body when the local entry has none", async () => {
    await localDB.writings.save(baseLocal())

    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(detailResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const applied = await hydrateLocalWritingFromRemote("writing-1")

    expect(applied).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/writings/writing-1",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    )

    const stored = await localDB.writings.get("writing-1")
    expect(stored?.body_text).toBe("Hello remote")
  })

  it("skips the network entirely when the local body is already present", async () => {
    await localDB.writings.save(
      baseLocal({
        body_text: "Hello",
        body_json: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
        },
      }),
    )

    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const applied = await hydrateLocalWritingFromRemote("writing-1")

    expect(applied).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not fetch a local-only writing (never synced)", async () => {
    await localDB.writings.save(
      baseLocal({ lifecycle: "local-only", body_text: "" }),
    )

    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const applied = await hydrateLocalWritingFromRemote("writing-1")

    expect(applied).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("deduplicates two concurrent calls for the same writingId into a single GET", async () => {
    await localDB.writings.save(baseLocal())

    let resolveResponse: ((response: Response) => void) | null = null
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    // Two entry-path effects fire in the same tick for the same writing.
    // They must share a single in-flight promise so only one GET is issued.
    const first = hydrateLocalWritingFromRemote("writing-1")
    const second = hydrateLocalWritingFromRemote("writing-1")
    expect(first).toBe(second)

    // Wait for the shared promise to reach its single fetch invocation
    // (it awaits localDB.writings.get first, which is async over IndexedDB).
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    resolveResponse!(
      new Response(JSON.stringify(detailResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const stored = await localDB.writings.get("writing-1")
    expect(stored?.body_text).toBe("Hello remote")
  })

  it("does NOT share the promise across different writingIds (correspondencia hijo a hijo)", async () => {
    await localDB.writings.save(baseLocal({ id: "writing-a" }))
    await localDB.writings.save(baseLocal({ id: "writing-b" }))

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      const id = url.split("/").pop() ?? "unknown"
      return Promise.resolve(
        new Response(
          JSON.stringify(
            detailResponse({ id, body_text: `Body for ${id}` } as Partial<LocalWriting>),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const [appliedA, appliedB] = await Promise.all([
      hydrateLocalWritingFromRemote("writing-a"),
      hydrateLocalWritingFromRemote("writing-b"),
    ])

    expect(appliedA).toBe(true)
    expect(appliedB).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("releases the in-flight slot when the fetch fails so a retry can run", async () => {
    await localDB.writings.save(baseLocal())

    const failingFetch = vi.fn(() => Promise.reject(new Error("network down")))
    vi.stubGlobal("fetch", failingFetch)

    await expect(hydrateLocalWritingFromRemote("writing-1")).rejects.toThrow(
      "network down",
    )

    const okFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(detailResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    vi.stubGlobal("fetch", okFetch)

    const retried = await hydrateLocalWritingFromRemote("writing-1")
    expect(retried).toBe(true)
    expect(okFetch).toHaveBeenCalledTimes(1)
  })
})
