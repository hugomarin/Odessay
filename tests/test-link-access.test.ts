import { describe, expect, it } from "vitest"
import {
  getTestLinkInvitationState,
  normalizeTestLinkToken,
} from "@/lib/sharing/test-link-access"
import { getTestLinkEmail } from "@/lib/sharing/test-link"

describe("test link access guards", () => {
  it("normalizes valid tokens and rejects malformed tokens", () => {
    expect(normalizeTestLinkToken("  validToken_123-456  ")).toBe("validToken_123-456")
    expect(normalizeTestLinkToken("bad token with spaces")).toBeNull()
    expect(normalizeTestLinkToken("short")).toBeNull()
  })

  it("classifies invitation state for preview access", () => {
    const markerEmail = getTestLinkEmail("writing-42")

    expect(getTestLinkInvitationState(null)).toBe("not-found")
    expect(
      getTestLinkInvitationState({
        email: "invite@example.com",
        status: "pending",
        writing_id: "writing-42",
      }),
    ).toBe("not-found")

    expect(
      getTestLinkInvitationState({
        email: markerEmail,
        status: "expired",
        writing_id: "writing-42",
      }),
    ).toBe("revoked")

    expect(
      getTestLinkInvitationState({
        email: markerEmail,
        status: "pending",
        writing_id: null,
      }),
    ).toBe("revoked")

    expect(
      getTestLinkInvitationState({
        email: markerEmail,
        status: "pending",
        writing_id: "writing-42",
      }),
    ).toBe("ok")
  })
})
