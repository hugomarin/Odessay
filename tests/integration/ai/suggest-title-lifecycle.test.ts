/**
 * AI-01 — Suggest title reaches the provider regardless of sync lifecycle.
 *
 * The server route (`app/api/ai/title-suggestions/route.ts`) never reads or
 * needs `writingId` — its request schema only accepts `currentTitle` and
 * `bodyText`. `webAIService.suggestTitle` nonetheless hard-blocks the
 * request with `INVALID_INPUT` whenever the writing's local sync lifecycle
 * is `local-only` or `syncing`, via `checkWritingLifecycleForRemoteAI` — a
 * guard added in the same commit (ODE-205) as the equivalent guard on
 * `hydrateCorrectionBlocks`, where it IS load-bearing (correction blocks are
 * keyed server-side by writingId, so there is genuinely nothing to hydrate
 * for an unsynced writing). No such rationale exists for suggestTitle: a
 * brand-new draft — exactly when a title suggestion is most useful — is
 * `local-only` until its first sync completes, so real users hit this block
 * on real new documents. Desktop's AIService has no equivalent gate at all.
 *
 * See workflow/quality/capability-integration-map.md (AI-01).
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { webAIService } from "@/lib/services/web-ai-service"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { WritingLifecycle } from "@/lib/services/contracts/document-service"

const BODY_TEXT = "A short body with more than enough words to satisfy the minimum content check."

const makeLocalWriting = (id: string, lifecycle: WritingLifecycle): LocalWriting => ({
  id,
  body_json: {},
  body_text: BODY_TEXT,
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: lifecycle === "server-confirmed" ? "synced" : "pending",
  lifecycle,
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
  local_updated_at: Date.now(),
})

const stubSuccessfulProviderResponse = (title: string) =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({ data: { title, rationale: null }, error: null }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  )

beforeEach(() => {
  vi.stubGlobal("window", globalThis)
  setLocalDBScope(`ai-01-${crypto.randomUUID()}`)
})

describe("AI-01 — suggestTitle reaches the provider regardless of lifecycle", () => {
  it.each<WritingLifecycle>(["local-only", "syncing", "server-confirmed"])(
    "calls the provider for a %s writing instead of blocking on lifecycle",
    async (lifecycle) => {
      await localDB.writings.save(makeLocalWriting("writing-1", lifecycle))
      const fetchMock = stubSuccessfulProviderResponse(`Title for ${lifecycle}`)
      vi.stubGlobal("fetch", fetchMock)

      const result = await webAIService.suggestTitle({
        currentTitle: "Untitled artifact",
        bodyText: BODY_TEXT,
        writingId: "writing-1",
      })

      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(calls[0]?.[0]).toBe("/api/ai/title-suggestions")
      expect(result.error).toBeNull()
      expect(result.data?.title).toBe(`Title for ${lifecycle}`)
    },
  )

  it("still works when no writingId is provided at all (new, never-saved draft)", async () => {
    const fetchMock = stubSuccessfulProviderResponse("Title for brand-new draft")
    vi.stubGlobal("fetch", fetchMock)

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled artifact",
      bodyText: BODY_TEXT,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
    expect(result.data?.title).toBe("Title for brand-new draft")
  })
})

describe("AI-01 — hydrateCorrectionBlocks keeps its legitimate lifecycle guard", () => {
  it.each<WritingLifecycle>(["local-only", "syncing"])(
    "skips the network for a %s writing (nothing exists server-side to hydrate yet)",
    async (lifecycle) => {
      await localDB.writings.save(makeLocalWriting("writing-1", lifecycle))
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)

      const result = await webAIService.hydrateCorrectionBlocks("writing-1")

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    },
  )

  it("calls the network for a server-confirmed writing", async () => {
    await localDB.writings.save(makeLocalWriting("writing-1", "server-confirmed"))
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await webAIService.hydrateCorrectionBlocks("writing-1")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
  })
})
