import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { releaseAiAdmission, tryAcquireAiAdmission } from "@/lib/ai/admission"
import { resetAdmissionConfigCacheForTests } from "@/lib/ai/admission-config"

const rpcMock = vi.hoisted(() => vi.fn())
const createAdminClientMock = vi.hoisted(() => vi.fn(() => ({ rpc: rpcMock })))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}))

describe("tryAcquireAiAdmission", () => {
  beforeEach(() => {
    rpcMock.mockReset()
    createAdminClientMock.mockClear()
  })

  afterEach(() => {
    delete process.env.AI_QUOTA_TITLE_SUGGESTIONS_PER_MIN
    delete process.env.AI_QUOTA_CONCURRENCY_PER_ACCOUNT
    delete process.env.AI_QUOTA_LEASE_SECONDS
    resetAdmissionConfigCacheForTests()
  })

  it("calls the RPC with the route's configured limits and returns the lease on admission", async () => {
    process.env.AI_QUOTA_TITLE_SUGGESTIONS_PER_MIN = "7"
    process.env.AI_QUOTA_CONCURRENCY_PER_ACCOUNT = "3"
    process.env.AI_QUOTA_LEASE_SECONDS = "45"
    resetAdmissionConfigCacheForTests()

    rpcMock.mockResolvedValue({
      data: [{ admitted: true, lease_id: "lease-abc", retry_after_seconds: 0, reason: "admitted" }],
      error: null,
    })

    const result = await tryAcquireAiAdmission({ accountId: "acct-1", routeKey: "title-suggestions" })

    expect(result).toEqual({ admitted: true, leaseId: "lease-abc" })
    expect(rpcMock).toHaveBeenCalledWith("ai_admission_try_acquire", {
      p_account_id: "acct-1",
      p_route_key: "title-suggestions",
      p_window_seconds: 60,
      p_rate_limit: 7,
      p_concurrency_limit: 3,
      p_lease_seconds: 45,
    })
  })

  it("surfaces a rate_limited rejection with its retry hint", async () => {
    rpcMock.mockResolvedValue({
      data: [{ admitted: false, lease_id: null, retry_after_seconds: 12, reason: "rate_limited" }],
      error: null,
    })

    const result = await tryAcquireAiAdmission({ accountId: "acct-1", routeKey: "publication-review" })

    expect(result).toEqual({ admitted: false, reason: "rate_limited", retryAfterSeconds: 12 })
  })

  it("surfaces a concurrency_limited rejection", async () => {
    rpcMock.mockResolvedValue({
      data: [{ admitted: false, lease_id: null, retry_after_seconds: 1, reason: "concurrency_limited" }],
      error: null,
    })

    const result = await tryAcquireAiAdmission({ accountId: "acct-1", routeKey: "transcription" })

    expect(result).toEqual({ admitted: false, reason: "concurrency_limited", retryAfterSeconds: 1 })
  })

  it("fails closed with a retryable rejection when the admission store errors, rather than admitting unlimited traffic", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } })

    const result = await tryAcquireAiAdmission({ accountId: "acct-1", routeKey: "transcription" })

    expect(result.admitted).toBe(false)
    if (!result.admitted) {
      expect(result.reason).toBe("concurrency_limited")
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it("handles a plain-object RPC response as well as an array", async () => {
    rpcMock.mockResolvedValue({
      data: { admitted: true, lease_id: "lease-xyz", retry_after_seconds: 0, reason: "admitted" },
      error: null,
    })

    const result = await tryAcquireAiAdmission({ accountId: "acct-1", routeKey: "transcription" })

    expect(result).toEqual({ admitted: true, leaseId: "lease-xyz" })
  })
})

describe("releaseAiAdmission", () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it("calls the release RPC with the lease id", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await releaseAiAdmission("lease-abc")

    expect(rpcMock).toHaveBeenCalledWith("ai_admission_release", { p_lease_id: "lease-abc" })
  })

  it("never throws even when the release RPC errors — an unreleased lease self-heals via expires_at", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not found" } })

    await expect(releaseAiAdmission("lease-abc")).resolves.toBeUndefined()
  })
})
