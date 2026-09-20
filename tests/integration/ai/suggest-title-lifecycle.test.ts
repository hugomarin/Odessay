/**
 * AI-01 — Suggest title reaches the real route and provider regardless of
 * sync lifecycle.
 *
 * The internal chain is: webAIService.suggestTitle -> fetch("/api/ai/title-suggestions")
 * -> the real POST route handler (request validation, content validation,
 * prompt construction, response parsing) -> fetch(provider chatCompletionsUrl)
 * -> the external AI provider. Only that last hop is genuinely external and
 * faked here; everything between webAIService and the provider call is the
 * real, unmodified production code, connected through a single global
 * `fetch` router that dispatches by URL instead of a real HTTP server.
 *
 * `checkWritingLifecycleForRemoteAI` used to hard-block the request with
 * `INVALID_INPUT` before it ever reached this chain, whenever the writing's
 * local sync lifecycle was `local-only` or `syncing` — exactly the state of
 * every brand-new draft until its first sync completes. The route never
 * reads or needs `writingId` at all (its schema only accepts
 * currentTitle/bodyText), so the guard protected nothing server-side; it
 * only produced false negatives on real documents. The guard was added in
 * the same commit (ODE-205) as the equivalent, legitimate guard on
 * `hydrateCorrectionBlocks` (correction blocks ARE keyed server-side by
 * writingId, so there's genuinely nothing to hydrate for an unsynced
 * writing) — that one stays, and has its own control below.
 *
 * See workflow/quality/capability-integration-map.md (AI-01).
 */
import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { webAIService } from "@/lib/services/web-ai-service"
import { POST as titleSuggestionsRoute } from "@/app/api/ai/title-suggestions/route"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { WritingLifecycle } from "@/lib/services/contracts/document-service"

const BODY_TEXT = "A short body with more than enough words to satisfy the minimum content check."
const PROVIDER_CHAT_COMPLETIONS_URL = "https://api.fireworks.ai/inference/v1/chat/completions"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const admissionMock = vi.hoisted(() => ({
  tryAcquireAiAdmission: vi.fn(),
  releaseAiAdmission: vi.fn(),
  logAiAdmissionEvent: vi.fn(),
}))

// Deliberately kept as deterministic test boundaries, per the reviewer's
// explicit carve-out: auth/admission are not the AI-01 property (they don't
// depend on writing lifecycle at all), and the real implementations hit a
// live Supabase project (cookie/session auth, an admin-client RPC for
// admission) that cannot run inside Vitest. Everything else below —
// getAIProviderConfig, the route's own validation/prompt/parsing, and
// webAIService itself — is real and unmocked.
vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
}))

vi.mock("@/lib/ai/admission", () => admissionMock)

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

const makeProviderResponse = (title: string) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )

let routeCallCount = 0
let providerCallCount = 0
let providerResponseTitle = "Untitled"

/**
 * A single global fetch router standing in for the network: it recognizes
 * the two URLs this chain actually calls — the app's own relative API path,
 * and the real Fireworks chat-completions endpoint the real
 * getAIProviderConfig() resolves to — and dispatches accordingly. Anything
 * else throws, so a future change that starts calling some other URL fails
 * loudly instead of silently returning nothing.
 */
const fetchRouter = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString()

  if (url === "/api/ai/title-suggestions") {
    routeCallCount += 1
    const request = new Request(`https://app.odessay.com${url}`, init)
    return titleSuggestionsRoute(request)
  }

  if (url === PROVIDER_CHAT_COMPLETIONS_URL) {
    providerCallCount += 1
    return makeProviderResponse(providerResponseTitle)
  }

  throw new Error(`Unexpected fetch to ${url} in the AI-01 proof`)
})

beforeEach(() => {
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal("fetch", fetchRouter)
  setLocalDBScope(`ai-01-${crypto.randomUUID()}`)

  process.env.FIREWORKS_API_KEY = "test-key"
  process.env.FIREWORKS_MODEL = "test-model"

  routeCallCount = 0
  providerCallCount = 0
  providerResponseTitle = "Untitled"

  supabaseMock.getUser.mockReset()
  supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  admissionMock.tryAcquireAiAdmission.mockReset()
  admissionMock.tryAcquireAiAdmission.mockResolvedValue({ admitted: true, leaseId: "lease-1" })
  admissionMock.releaseAiAdmission.mockReset()
  admissionMock.logAiAdmissionEvent.mockReset()
})

afterEach(() => {
  delete process.env.FIREWORKS_API_KEY
  delete process.env.FIREWORKS_MODEL
})

describe("AI-01 — suggestTitle reaches the real route and provider regardless of lifecycle", () => {
  it.each<WritingLifecycle>(["local-only", "syncing", "server-confirmed"])(
    "for a %s writing: real route runs, real provider is called, suggestion returns",
    async (lifecycle) => {
      await localDB.writings.save(makeLocalWriting("writing-1", lifecycle))
      providerResponseTitle = `Title for ${lifecycle}`

      const result = await webAIService.suggestTitle({
        currentTitle: "Untitled artifact",
        bodyText: BODY_TEXT,
        writingId: "writing-1",
      })

      expect(routeCallCount).toBe(1)
      expect(providerCallCount).toBe(1)
      expect(admissionMock.tryAcquireAiAdmission).toHaveBeenCalledWith({
        accountId: "user-1",
        routeKey: "title-suggestions",
      })
      expect(admissionMock.releaseAiAdmission).toHaveBeenCalledWith("lease-1")
      expect(result.error).toBeNull()
      expect(result.data?.title).toBe(`Title for ${lifecycle}`)
    },
  )

  it("still reaches the real route and provider when no writingId is provided at all (new, never-saved draft)", async () => {
    providerResponseTitle = "Title for brand-new draft"

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled artifact",
      bodyText: BODY_TEXT,
    })

    expect(routeCallCount).toBe(1)
    expect(providerCallCount).toBe(1)
    expect(result.error).toBeNull()
    expect(result.data?.title).toBe("Title for brand-new draft")
  })
})

describe("AI-01 — hydrateCorrectionBlocks keeps its legitimate lifecycle guard", () => {
  it.each<WritingLifecycle>(["local-only", "syncing"])(
    "skips the network for a %s writing (nothing exists server-side to hydrate yet)",
    async (lifecycle) => {
      await localDB.writings.save(makeLocalWriting("writing-1", lifecycle))
      const fetchSpy = vi.fn()
      vi.stubGlobal("fetch", fetchSpy)

      const result = await webAIService.hydrateCorrectionBlocks("writing-1")

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.error).toBeNull()
      expect(result.data).toEqual([])
    },
  )

  it("calls the network for a server-confirmed writing", async () => {
    await localDB.writings.save(makeLocalWriting("writing-1", "server-confirmed"))
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchSpy)

    const result = await webAIService.hydrateCorrectionBlocks("writing-1")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
  })
})
