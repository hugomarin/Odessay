import { beforeEach, describe, expect, it, vi } from "vitest"
import { desktopAuthService } from "@/lib/services/desktop-auth-service"

// ─── Mocks ────────────────────────────────────────────────────────────────────

const supabaseAuthMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: supabaseAuthMock,
    storageKey: "sb-test-auth-token",
  }),
}))

const keychainStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}))

vi.mock("@/lib/auth/secure-storage", () => ({
  keychainStorage: keychainStorageMock,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const storedUser = {
  id: "user-offline",
  email: "writer@example.com",
  new_email: null,
  email_confirmed_at: "2026-05-01T00:00:00.000Z",
  user_metadata: { display_name: "Writer", username: "writer" },
}

const storedSessionJson = JSON.stringify({
  access_token: "expired-access-token",
  refresh_token: "refresh-token",
  expires_at: 1750000000,
  user: storedUser,
})

// Mirrors @supabase/auth-js AuthRetryableFetchError: fetch() rejects offline
// (`TypeError: Load failed`) and the SDK wraps it with status 0.
const transportError = { name: "AuthRetryableFetchError", message: "Load failed", status: 0 }

// ─── getSession offline semantics (ODE-415) ───────────────────────────────────

describe("desktopAuthService.getSession offline semantics", () => {
  beforeEach(() => {
    supabaseAuthMock.getUser.mockReset()
    keychainStorageMock.getItem.mockReset()
  })

  it("a transport failure with a locally stored session is `unverified`, not `anonymous`", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({ data: { user: null }, error: transportError })
    keychainStorageMock.getItem.mockResolvedValue(storedSessionJson)

    const result = await desktopAuthService.getSession()

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      status: "unverified",
      user: {
        id: "user-offline",
        email: "writer@example.com",
        displayName: "Writer",
        username: "writer",
      },
    })
    // The fallback reads local storage only — no second network request.
    expect(supabaseAuthMock.getUser).toHaveBeenCalledOnce()
    expect(keychainStorageMock.getItem).toHaveBeenCalledWith("sb-test-auth-token")
  })

  it("a 5xx server error with a locally stored session is `unverified`, not `anonymous`", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthApiError", message: "Internal server error", status: 500 },
    })
    keychainStorageMock.getItem.mockResolvedValue(storedSessionJson)

    const result = await desktopAuthService.getSession()

    expect(result.error).toBeNull()
    expect(result.data?.status).toBe("unverified")
    expect(result.data?.user?.id).toBe("user-offline")
  })

  it("a real 401 rejection is `anonymous` — the only result that justifies a login redirect", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthApiError", message: "Invalid JWT", status: 401 },
    })

    const result = await desktopAuthService.getSession()

    expect(result.error).toBeNull()
    expect(result.data).toEqual({ status: "anonymous", user: null })
    // No need to consult local storage: the server already rejected the token.
    expect(keychainStorageMock.getItem).not.toHaveBeenCalled()
  })

  it("a missing stored session (AuthSessionMissingError) is `anonymous`", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 },
    })

    const result = await desktopAuthService.getSession()

    expect(result.data).toEqual({ status: "anonymous", user: null })
    expect(keychainStorageMock.getItem).not.toHaveBeenCalled()
  })

  it("a transport failure with no locally stored session is UNAVAILABLE, not `anonymous`", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({ data: { user: null }, error: transportError })
    keychainStorageMock.getItem.mockResolvedValue(null)

    const result = await desktopAuthService.getSession()

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAVAILABLE")
    expect(result.error?.retryable).toBe(true)
  })

  it("a transport failure with corrupted stored session is UNAVAILABLE, not `anonymous`", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({ data: { user: null }, error: transportError })
    keychainStorageMock.getItem.mockResolvedValue("{not valid json")

    const result = await desktopAuthService.getSession()

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAVAILABLE")
  })

  it("a transport failure with a stored session without user is UNAVAILABLE", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({ data: { user: null }, error: transportError })
    keychainStorageMock.getItem.mockResolvedValue(JSON.stringify({ access_token: "x" }))

    const result = await desktopAuthService.getSession()

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAVAILABLE")
  })

  it("a successful verification still returns `authenticated`", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: storedUser },
      error: null,
    })

    const result = await desktopAuthService.getSession()

    expect(result.error).toBeNull()
    expect(result.data?.status).toBe("authenticated")
    expect(keychainStorageMock.getItem).not.toHaveBeenCalled()
  })
})
