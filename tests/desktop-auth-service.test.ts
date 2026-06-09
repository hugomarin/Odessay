import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { AuthService, AuthSession, AccountIdentity } from "@/lib/services/contracts/auth-service"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import { desktopAuthService } from "@/lib/services/desktop-auth-service"
import { webAuthService } from "@/lib/services/web-auth-service"
import { getAuthService } from "@/lib/services/auth-service-factory"
import * as runtimeDetect from "@/lib/runtime/detect"
import * as accountSettings from "@/lib/auth/account-settings"

// ─── Mocks ────────────────────────────────────────────────────────────────────

const supabaseAuthMock = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  from: vi.fn(),
}))

const supabaseFromMock = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
}))

const supabaseRpcMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: supabaseAuthMock,
    from: () => supabaseFromMock,
    rpc: supabaseRpcMock,
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

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: supabaseAuthMock,
    from: () => supabaseFromMock,
    rpc: supabaseRpcMock,
    storageKey: "sb-test-auth-token",
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
    supabaseAuthMock.onAuthStateChange.mockReset()
    supabaseAuthMock.signUp.mockReset()
    supabaseAuthMock.signOut.mockReset()
    supabaseAuthMock.getUser.mockReset()
    supabaseAuthMock.updateUser.mockReset()
    supabaseRpcMock.mockReset()
    supabaseFromMock.maybeSingle.mockReset()
    supabaseFromMock.select.mockReturnThis()
    supabaseFromMock.eq.mockReturnThis()
    supabaseFromMock.update.mockReturnThis()
    supabaseFromMock.single.mockResolvedValue({ data: { id: "user-1" }, error: null })
    supabaseAuthMock.onAuthStateChange.mockImplementation((callback) => {
      queueMicrotask(() => {
        callback("SIGNED_IN", { user: { id: "session-user" } })
      })
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      }
    })
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

  it("signOut returns SIGNOUT_INCOMPLETE when supabase.auth.signOut times out", async () => {
    vi.useFakeTimers()
    supabaseAuthMock.signOut.mockImplementation(() => new Promise(() => {}))
    keychainStorageMock.removeItem.mockResolvedValue(undefined)

    const signOutPromise = desktopAuthService.signOut()
    vi.advanceTimersByTime(5000)

    const result = await signOutPromise

    expect(supabaseAuthMock.signOut).toHaveBeenCalledOnce()
    expect(keychainStorageMock.removeItem).toHaveBeenCalledWith("sb-test-auth-token")
    expect(keychainStorageMock.removeItem).toHaveBeenCalledWith("sb-test-auth-token-code-verifier")
    expect(result.error?.code).toBe("SIGNOUT_INCOMPLETE")
    expect(result.error?.message).toContain("timed out")
    expect(result.data).toBeNull()

    vi.useRealTimers()
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
      data: { id: "other-user" },
      error: null,
    })

    const result = await desktopAuthService.checkUsernameAvailability({
      username: "taken_name",
    })

    expect(result.data?.available).toBe(false)
    expect(result.data?.reason).toBe("taken")
  })

  it("signUp sends web confirmation redirects to Supabase", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://odessay.vercel.app"

    supabaseAuthMock.signUp.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          new_email: null,
          email_confirmed_at: null,
          user_metadata: { display_name: "Writer", username: "writer" },
        },
        session: null,
      },
      error: null,
    })

    const result = await desktopAuthService.signUp({
      displayName: "Writer",
      username: "Writer",
      email: "writer@example.com",
      password: "supersecret",
      nextPath: "/desk",
    })

    expect(supabaseAuthMock.signUp).toHaveBeenCalledWith({
      email: "writer@example.com",
      password: "supersecret",
      options: {
        emailRedirectTo: "https://odessay.vercel.app/auth/confirm?next=%2Fdesk",
        data: {
          display_name: "Writer",
          username: "writer",
        },
      },
    })
    expect(result.data?.requiresEmailConfirmation).toBe(true)
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
    expect(supabaseFromMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "New Name" }),
    )
    expect(result.data?.displayName).toBe("New Name")

    vi.unstubAllGlobals()
  })

  it("updateUsername claims and syncs username directly without calling /api/*", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    supabaseAuthMock.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          user_metadata: { username: "writer" },
        },
      },
      error: null,
    })
    supabaseFromMock.maybeSingle
      .mockResolvedValueOnce({ data: { username: "writer" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    supabaseRpcMock.mockResolvedValue({
      data: [{ username: "writer_next", previous_username: "writer", reserved_until: null }],
      error: null,
    })
    supabaseAuthMock.updateUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          user_metadata: { display_name: "Writer", username: "writer_next" },
        },
      },
      error: null,
    })

    const result = await desktopAuthService.updateUsername({ username: "writer_next" })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(supabaseRpcMock).toHaveBeenCalledWith("claim_profile_username", {
      target_username: "writer_next",
    })
    expect(supabaseAuthMock.updateUser).toHaveBeenCalledWith({
      data: { username: "writer_next" },
    })
    expect(result.data?.username).toBe("writer_next")

    vi.unstubAllGlobals()
  })

  it("requestEmailChange uses a web callback redirect without calling /api/*", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com"
    supabaseAuthMock.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          email_confirmed_at: "2026-05-01T00:00:00.000Z",
          new_email: null,
          user_metadata: { display_name: "Writer", username: "writer" },
        },
      },
      error: null,
    })
    supabaseAuthMock.updateUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          new_email: "next@example.com",
          email_confirmed_at: "2026-05-01T00:00:00.000Z",
          user_metadata: { display_name: "Writer", username: "writer" },
        },
      },
      error: null,
    })

    const result = await desktopAuthService.requestEmailChange({ email: "next@example.com" })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(supabaseAuthMock.updateUser).toHaveBeenCalledWith(
      { email: "next@example.com" },
      { emailRedirectTo: "https://app.odessay.com/auth/confirm?next=%2Fsettings%2Faccount" },
    )
    expect(result.data?.pendingEmail).toBe("next@example.com")

    vi.unstubAllGlobals()
  })

  it("updatePassword verifies the current password and updates directly without /api/*", async () => {
    const fetchSpy = vi.fn()
    const verifyCurrentPasswordSpy = vi
      .spyOn(accountSettings, "verifyCurrentPassword")
      .mockResolvedValue(true)
    vi.stubGlobal("fetch", fetchSpy)
    supabaseAuthMock.getUser.mockResolvedValue({
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
    supabaseAuthMock.updateUser.mockResolvedValue({
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
    supabaseAuthMock.signOut.mockResolvedValue({ error: null })

    const result = await desktopAuthService.updatePassword({
      currentPassword: "old-secret",
      newPassword: "new-secret-123",
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(verifyCurrentPasswordSpy).toHaveBeenCalledWith("writer@example.com", "old-secret")
    expect(supabaseAuthMock.updateUser).toHaveBeenCalledWith({ password: "new-secret-123" })
    expect(supabaseAuthMock.signOut).toHaveBeenCalledWith({ scope: "others" })
    expect(result.error).toBeNull()

    verifyCurrentPasswordSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
