import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { AuthService, AuthSession, AccountIdentity } from "@/lib/services/contracts/auth-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import { desktopAuthService } from "@/lib/services/desktop-auth-service"
import { webAuthService } from "@/lib/services/web-auth-service"
import { getAuthService } from "@/lib/services/auth-service-factory"
import * as runtimeDetect from "@/lib/runtime/detect"

// ─── Mocks ────────────────────────────────────────────────────────────────────

const supabaseAuthMock = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  from: vi.fn(),
}))

const supabaseFromMock = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: supabaseAuthMock,
    from: () => supabaseFromMock,
  }),
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: supabaseAuthMock,
    from: () => supabaseFromMock,
  }),
}))

// isTauriRuntime is stubbed per test via vi.stubGlobal
vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: vi.fn(() => false),
  isWebRuntime: vi.fn(() => true),
}))

// ─── Contract compliance ───────────────────────────────────────────────────────

describe("AuthService contract compliance", () => {
  it("desktopAuthService satisfies the AuthService interface (type-level)", () => {
    expectTypeOf(desktopAuthService).toMatchTypeOf<AuthService>()
  })

  it("webAuthService satisfies the AuthService interface (type-level)", () => {
    expectTypeOf(webAuthService).toMatchTypeOf<AuthService>()
  })

  it("desktopAuthService exposes every required method", () => {
    const methods: Array<keyof AuthService> = [
      "signIn",
      "signUp",
      "signOut",
      "getSession",
      "checkUsernameAvailability",
      "updateDisplayName",
      "updateUsername",
      "requestEmailChange",
      "updatePassword",
    ]
    for (const method of methods) {
      expect(typeof desktopAuthService[method]).toBe("function")
    }
  })

  it("all methods return ServiceResponse-shaped promises", async () => {
    expectTypeOf(desktopAuthService.signIn).returns.toMatchTypeOf<
      Promise<ServiceResponse<AuthSession>>
    >()
    expectTypeOf(desktopAuthService.getSession).returns.toMatchTypeOf<
      Promise<ServiceResponse<AuthSession>>
    >()
    expectTypeOf(desktopAuthService.signOut).returns.toMatchTypeOf<
      Promise<ServiceResponse<null>>
    >()
    expectTypeOf(desktopAuthService.updateDisplayName).returns.toMatchTypeOf<
      Promise<ServiceResponse<AccountIdentity>>
    >()
  })
})

// ─── Factory selection ────────────────────────────────────────────────────────

describe("getAuthService factory", () => {
  const isTauriRuntime = vi.mocked(runtimeDetect.isTauriRuntime)

  beforeEach(() => {
    isTauriRuntime.mockReset()
  })

  it("returns webAuthService when not in Tauri runtime", () => {
    isTauriRuntime.mockReturnValue(false)
    expect(getAuthService()).toBe(webAuthService)
  })

  it("returns desktopAuthService when in Tauri runtime", () => {
    isTauriRuntime.mockReturnValue(true)
    expect(getAuthService()).toBe(desktopAuthService)
  })

  it("is side-effect-free — repeated calls return the same instance reference", () => {
    isTauriRuntime.mockReturnValue(false)
    expect(getAuthService()).toBe(getAuthService())

    isTauriRuntime.mockReturnValue(true)
    expect(getAuthService()).toBe(getAuthService())
  })
})

// ─── desktopAuthService behaviour ─────────────────────────────────────────────

describe("desktopAuthService", () => {
  beforeEach(() => {
    supabaseAuthMock.signInWithPassword.mockReset()
    supabaseAuthMock.signUp.mockReset()
    supabaseAuthMock.signOut.mockReset()
    supabaseAuthMock.getUser.mockReset()
    supabaseAuthMock.updateUser.mockReset()
    supabaseFromMock.maybeSingle.mockReset()
    supabaseFromMock.select.mockReturnThis()
    supabaseFromMock.eq.mockReturnThis()
  })

  // signIn — Performance Contract: exactly 1 Supabase request, 0 /api/* calls
  it("signIn calls supabase.auth.signInWithPassword directly (no /api/* fetch)", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    supabaseAuthMock.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          new_email: null,
          email_confirmed_at: "2026-05-01T00:00:00.000Z",
          user_metadata: { display_name: "Writer", username: "writer" },
        },
      },
      error: null,
    })

    const result = await desktopAuthService.signIn({
      email: " Writer@Example.com ",
      password: "s3cr3t",
    })

    expect(supabaseAuthMock.signInWithPassword).toHaveBeenCalledOnce()
    expect(supabaseAuthMock.signInWithPassword).toHaveBeenCalledWith({
      email: "writer@example.com",
      password: "s3cr3t",
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      status: "authenticated",
      user: { id: "user-1", email: "writer@example.com" },
    })

    vi.unstubAllGlobals()
  })

  it("signIn returns UNAUTHORIZED when Supabase returns an auth error", async () => {
    supabaseAuthMock.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    })

    const result = await desktopAuthService.signIn({ email: "x@x.com", password: "bad" })

    expect(result.data).toBeNull()
    expect(result.error?.code).toBe("UNAUTHORIZED")
  })

  it("signIn normalizes email before sending to Supabase", async () => {
    supabaseAuthMock.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "error" },
    })

    await desktopAuthService.signIn({ email: "  Upper@EXAMPLE.COM  ", password: "p" })

    expect(supabaseAuthMock.signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "upper@example.com" }),
    )
  })

  // getSession — reads from Supabase in-memory client (stub for Keychain)
  it("getSession calls supabase.auth.getUser and returns normalized session", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          email: "reader@example.com",
          new_email: null,
          email_confirmed_at: "2026-04-01T00:00:00.000Z",
          user_metadata: { display_name: "Reader", username: "reader" },
        },
      },
      error: null,
    })

    const result = await desktopAuthService.getSession()

    expect(supabaseAuthMock.getUser).toHaveBeenCalledOnce()
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      status: "authenticated",
      user: { id: "user-2", username: "reader" },
    })
  })

  it("getSession returns anonymous session when no user is logged in", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const result = await desktopAuthService.getSession()

    expect(result.data).toEqual({ status: "anonymous", user: null })
    expect(result.error).toBeNull()
  })

  it("signOut calls supabase.auth.signOut directly", async () => {
    supabaseAuthMock.signOut.mockResolvedValue({ error: null })

    const result = await desktopAuthService.signOut()

    expect(supabaseAuthMock.signOut).toHaveBeenCalledOnce()
    expect(result).toEqual({ data: null, error: null })
  })

  it("checkUsernameAvailability queries public_profiles without calling /api/*", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    supabaseFromMock.maybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await desktopAuthService.checkUsernameAvailability({
      username: "available_name",
      scope: "signup",
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.data?.available).toBe(true)
    expect(result.data?.username).toBe("available_name")

    vi.unstubAllGlobals()
  })

  it("checkUsernameAvailability reports taken when profile exists", async () => {
    supabaseFromMock.maybeSingle.mockResolvedValue({
      data: { username: "taken_name" },
      error: null,
    })

    const result = await desktopAuthService.checkUsernameAvailability({
      username: "taken_name",
    })

    expect(result.data?.available).toBe(false)
    expect(result.data?.reason).toBe("taken")
  })

  it("updateDisplayName uses supabase.auth.updateUser without calling /api/*", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    supabaseAuthMock.updateUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "w@example.com",
          new_email: null,
          email_confirmed_at: null,
          user_metadata: { display_name: "New Name", username: "writer" },
        },
      },
      error: null,
    })

    const result = await desktopAuthService.updateDisplayName({ displayName: "New Name" })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(supabaseAuthMock.updateUser).toHaveBeenCalledWith({ data: { display_name: "New Name" } })
    expect(result.data?.displayName).toBe("New Name")

    vi.unstubAllGlobals()
  })
})
