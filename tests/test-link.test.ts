import { describe, expect, it } from "vitest"
import {
  buildTestLinkPath,
  createTestLinkToken,
  getTestLinkEmail,
  isTestLinkEmail,
  pickLatestPendingTestLink,
} from "@/lib/sharing/test-link"

describe("test link helpers", () => {
  it("creates token-safe preview paths", () => {
    const token = createTestLinkToken()

    expect(token.length).toBeGreaterThanOrEqual(24)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(buildTestLinkPath(token)).toBe(`/preview/${token}`)
  })

  it("flags marker emails for closed sharing links", () => {
    const email = getTestLinkEmail("1f4be6a5-8887-4f87-9224-a9eeb3cf865f")

    expect(email).toBe("ux-eval+1f4be6a5-8887-4f87-9224-a9eeb3cf865f@odessay.local")
    expect(isTestLinkEmail(email)).toBe(true)
    expect(isTestLinkEmail("writer@example.com")).toBe(false)
  })

  it("picks the latest pending test link invitation for a writing", () => {
    const writingId = "writing-123"
    const markerEmail = getTestLinkEmail(writingId)

    const picked = pickLatestPendingTestLink(
      [
        {
          token: "accepted-token",
          email: markerEmail,
          status: "accepted",
          created_at: "2026-03-19T01:00:00.000Z",
        },
        {
          token: "pending-older",
          email: markerEmail,
          status: "pending",
          created_at: "2026-03-19T02:00:00.000Z",
        },
        {
          token: "pending-newest",
          email: markerEmail,
          status: "pending",
          created_at: "2026-03-19T03:00:00.000Z",
        },
        {
          token: "pending-other-writing",
          email: getTestLinkEmail("writing-999"),
          status: "pending",
          created_at: "2026-03-19T04:00:00.000Z",
        },
      ],
      writingId,
    )

    expect(picked?.token).toBe("pending-newest")
  })

  it("ignores non-pending links even when they are the newest", () => {
    const writingId = "writing-123"
    const markerEmail = getTestLinkEmail(writingId)

    const picked = pickLatestPendingTestLink(
      [
        {
          token: "expired-newest",
          email: markerEmail,
          status: "expired",
          created_at: "2026-03-19T05:00:00.000Z",
        },
        {
          token: "pending-valid",
          email: markerEmail,
          status: "pending",
          created_at: "2026-03-19T03:00:00.000Z",
        },
      ],
      writingId,
    )

    expect(picked?.token).toBe("pending-valid")
  })
})
