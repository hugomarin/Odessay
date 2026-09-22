import { afterEach, describe, expect, it, beforeEach } from "vitest"
import { vi } from "vitest"

vi.mock("@/lib/supabase/shared", () => ({
  supabasePublicKey: "test-key",
  supabaseUrl: "https://example.supabase.co",
}))

const mockGetUser = vi.fn()
const mockSetAll = vi.fn()

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    // Capture the setAll callback so tests can verify it was wired
    if (options?.cookies?.setAll) {
      mockSetAll.mockImplementation(options.cookies.setAll)
    }
    return {
      auth: {
        getUser: mockGetUser,
      },
    }
  }),
}))

import { NextRequest, NextResponse } from "next/server"
import { extractMalformedAuthRedirect, updateSession } from "@/lib/supabase/middleware"

describe("extractMalformedAuthRedirect", () => {
  const appOrigin = "https://example.com"

  it("returns null for normal app paths", () => {
    expect(extractMalformedAuthRedirect("/settings/account", "", appOrigin)).toBeNull()
  })

  it("recovers malformed email-change links that fell back to the site root", () => {
    expect(
      extractMalformedAuthRedirect(
        "/&token_hash=abc123&type=email_change",
        "",
        appOrigin,
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
        appOrigin,
      ),
    ).toEqual({
      tokenHash: "abc123",
      type: "recovery",
      next: "/reset-password",
    })
  })

  it("rejects malformed auth links with unsupported types", () => {
    expect(extractMalformedAuthRedirect("/&token_hash=abc123&type=unknown", "", appOrigin)).toBeNull()
  })

  it("falls back to the type's default when the next param is an off-origin backslash bypass", () => {
    expect(
      extractMalformedAuthRedirect(
        "/&token_hash=abc123&type=recovery&next=%2F%5Cattacker.invalid",
        "",
        appOrigin,
      ),
    ).toEqual({
      tokenHash: "abc123",
      type: "recovery",
      next: "/reset-password",
    })
  })
})

describe("updateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function makeRequest(pathname: string) {
    return new NextRequest(new URL(`https://example.com${pathname}`))
  }

  it("runs createServerClient for /api routes so session refresh can occur", async () => {
    const { createServerClient } = await import("@supabase/ssr")
    const request = makeRequest("/api/writings")
    await updateSession(request)
    expect(createServerClient).toHaveBeenCalledTimes(1)
  })

  it("allows /api requests to proceed without redirect when user is unauthenticated", async () => {
    const request = makeRequest("/api/writings")
    const response = await updateSession(request)
    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("writes refreshed session cookies back to the response for /api routes", async () => {
    const request = makeRequest("/api/writings")
    request.cookies.set("sb-access-token", "old-token")

    mockGetUser.mockImplementation(() => {
      // Simulate Supabase refreshing the token and calling setAll
      mockSetAll([{ name: "sb-access-token", value: "refreshed-token", options: {} }])
      return Promise.resolve({
        data: { user: { id: "user-123" } },
        error: null,
      })
    })

    const response = await updateSession(request)

    // Verify that the setAll callback was wired and the refreshed cookie was written
    expect(mockSetAll).toHaveBeenCalledTimes(1)
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed-token")
  })

  it("still redirects unauthenticated users away from private routes", async () => {
    const request = makeRequest("/desk")
    const response = await updateSession(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/login")
  })

  it("allows local evidence routes only when the test fixture flag is enabled", async () => {
    vi.stubEnv("ODE_TEST_LINK_FIXTURES", "1")
    const response = await updateSession(makeRequest("/evidence/settings-archived"))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it("keeps evidence routes private without the local fixture flag", async () => {
    const response = await updateSession(makeRequest("/evidence/settings-archived"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/login")
  })

  it("still allows authenticated users into private routes", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    })

    const request = makeRequest("/desk")
    const response = await updateSession(request)
    expect(response.status).toBe(200)
  })
})
