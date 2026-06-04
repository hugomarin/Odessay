import { describe, expect, it } from "vitest"
import { vi } from "vitest"

vi.mock("@/lib/supabase/shared", () => ({
  supabasePublicKey: "test-key",
  supabaseUrl: "https://example.supabase.co",
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}))

import { extractMalformedAuthRedirect } from "@/lib/supabase/middleware"

describe("extractMalformedAuthRedirect", () => {
  it("returns null for normal app paths", () => {
    expect(extractMalformedAuthRedirect("/settings/account", "")).toBeNull()
  })

  it("recovers malformed email-change links that fell back to the site root", () => {
    expect(
      extractMalformedAuthRedirect(
        "/&token_hash=abc123&type=email_change",
        "",
      ),
    ).toEqual({
      tokenHash: "abc123",
      type: "email_change",
      next: "/settings/account",
    })
  })

  it("preserves a safe next param when present in the malformed path", () => {
    expect(
      extractMalformedAuthRedirect(
        "/&token_hash=abc123&type=recovery&next=%2Freset-password",
        "",
      ),
    ).toEqual({
      tokenHash: "abc123",
      type: "recovery",
      next: "/reset-password",
    })
  })

  it("rejects malformed auth links with unsupported types", () => {
    expect(extractMalformedAuthRedirect("/&token_hash=abc123&type=unknown", "")).toBeNull()
  })
})
