import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  openDesktopDocument: vi.fn(),
}))

vi.mock("@/lib/services/desktop/open-document-desktop", () => ({
  openDesktopDocument: mocks.openDesktopDocument,
}))

import {
  computeOpenRetryDelayMs,
  openDocumentByIdWithRetry,
} from "@/lib/services/open-document-factory"

function retryableFailure(reasonCode = "catalog-unavailable") {
  return { status: "failed" as const, reason: "transient", reasonCode, retryable: true }
}

function terminalFailure(reasonCode = "unknown") {
  return { status: "failed" as const, reason: "permanent", reasonCode, retryable: false }
}

describe("computeOpenRetryDelayMs", () => {
  it("grows with attempt and stays within a bounded ceiling", () => {
    const random = () => 0.5
    const first = computeOpenRetryDelayMs(1, random)
    const second = computeOpenRetryDelayMs(2, random)
    const third = computeOpenRetryDelayMs(3, random)
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
    // Even at a high attempt count the delay never runs away unbounded.
    expect(computeOpenRetryDelayMs(20, random)).toBeLessThanOrEqual(4000 * 1.15)
  })

  it("jitters between two calls with different randomness", () => {
    const low = computeOpenRetryDelayMs(2, () => 0)
    const high = computeOpenRetryDelayMs(2, () => 1)
    expect(high).toBeGreaterThan(low)
  })
})

describe("openDocumentByIdWithRetry", () => {
  beforeEach(() => {
    mocks.openDesktopDocument.mockReset()
  })

  it("returns immediately on the first success without waiting", async () => {
    mocks.openDesktopDocument.mockResolvedValue({ status: "opened", documentId: "doc-1" })
    const wait = vi.fn(async () => {})

    const { result, attempt } = await openDocumentByIdWithRetry("doc-1", { wait })

    expect(result).toMatchObject({ status: "opened" })
    expect(attempt).toBe(1)
    expect(wait).not.toHaveBeenCalled()
    expect(mocks.openDesktopDocument).toHaveBeenCalledTimes(1)
  })

  it("rearms a retryable failure with backoff and succeeds without any interaction", async () => {
    mocks.openDesktopDocument
      .mockResolvedValueOnce(retryableFailure())
      .mockResolvedValueOnce(retryableFailure())
      .mockResolvedValueOnce({ status: "opened", documentId: "doc-1" })
    const wait = vi.fn(async () => {})

    const { result, attempt } = await openDocumentByIdWithRetry("doc-1", { wait, random: () => 0 })

    expect(result).toMatchObject({ status: "opened", documentId: "doc-1" })
    expect(attempt).toBe(3)
    expect(wait).toHaveBeenCalledTimes(2)
    expect(mocks.openDesktopDocument).toHaveBeenCalledTimes(3)
  })

  it("reproduces the rearm using real fake timers, no click/navigation/web event", async () => {
    vi.useFakeTimers()
    try {
      mocks.openDesktopDocument
        .mockResolvedValueOnce(retryableFailure())
        .mockResolvedValueOnce({ status: "opened", documentId: "doc-1" })

      const promise = openDocumentByIdWithRetry("doc-1")
      await vi.advanceTimersByTimeAsync(5000)
      const { result, attempt } = await promise

      expect(result).toMatchObject({ status: "opened", documentId: "doc-1" })
      expect(attempt).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not retry orphaned — terminal, no loop", async () => {
    mocks.openDesktopDocument.mockResolvedValue({ status: "orphaned", id: "doc-1" })
    const wait = vi.fn(async () => {})

    const { result, attempt } = await openDocumentByIdWithRetry("doc-1", { wait })

    expect(result).toMatchObject({ status: "orphaned" })
    expect(attempt).toBe(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it("does not retry a terminal failed outcome", async () => {
    mocks.openDesktopDocument.mockResolvedValue(terminalFailure())
    const wait = vi.fn(async () => {})

    const { result, attempt } = await openDocumentByIdWithRetry("doc-1", { wait })

    expect(result).toMatchObject({ status: "failed", retryable: false })
    expect(attempt).toBe(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it("stops after the bounded attempt ceiling and reports an explicit unavailable outcome", async () => {
    mocks.openDesktopDocument.mockResolvedValue(retryableFailure())
    const wait = vi.fn(async () => {})

    const { result, attempt } = await openDocumentByIdWithRetry("doc-1", { wait, maxAttempts: 3 })

    expect(result).toMatchObject({ status: "failed", retryable: true })
    expect(attempt).toBe(3)
    expect(wait).toHaveBeenCalledTimes(2)
    expect(mocks.openDesktopDocument).toHaveBeenCalledTimes(3)
  })

  it("cancels late work on a document switch (A→B) instead of hydrating A over B", async () => {
    let cancelled = false
    mocks.openDesktopDocument.mockResolvedValueOnce(retryableFailure())
    const wait = vi.fn(async () => {
      // Simulate the effect switching to document B mid-wait (unmount/target change).
      cancelled = true
    })

    const { attempt } = await openDocumentByIdWithRetry("doc-A", {
      wait,
      isCancelled: () => cancelled,
    })

    // One attempt made, one wait scheduled, then the cancellation check after the
    // wait stops the loop before a second attempt for A ever runs.
    expect(attempt).toBe(1)
    expect(mocks.openDesktopDocument).toHaveBeenCalledTimes(1)
  })

  it("never attempts at all when already cancelled before the first call", async () => {
    const { attempt } = await openDocumentByIdWithRetry("doc-1", { isCancelled: () => true })
    expect(attempt).toBe(1)
    expect(mocks.openDesktopDocument).toHaveBeenCalledTimes(1)
  })
})
