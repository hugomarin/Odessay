import { beforeEach, describe, expect, it, vi } from "vitest"
import { webAIService } from "@/lib/services/web-ai-service"
import { webAuthService } from "@/lib/services/web-auth-service"

const supabaseAuthMock = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
}))

const localDBMock = vi.hoisted(() => ({
  writings: {
    get: vi.fn(),
  },
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: supabaseAuthMock,
  }),
}))

vi.mock("@/lib/local-db", () => ({
  localDB: localDBMock,
}))

describe("webAIService", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localDBMock.writings.get.mockReset()
  })

  it("maps title suggestions from the web route envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: { title: "Quiet Dawn", rationale: "Matches the tone." },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled writing",
      bodyText: "A short body with enough content to ask for help.",
    })

    expect(result).toEqual({
      data: {
        title: "Quiet Dawn",
        rationale: "Matches the tone.",
      },
      error: null,
    })
  })

  it("normalizes publication review payloads into the contract shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              summary: "One correction.",
              language: "es",
              corrections: [
                {
                  blockId: "block-1",
                  type: "spelling",
                  originalText: "prueva",
                  replacementText: "prueba",
                },
              ],
              uncertain: [
                {
                  blockId: "block-1",
                  text: "Artifact Studio",
                  reason: "Brand term could be intentional.",
                  possibleReplacement: null,
                },
              ],
              promptTokens: 120,
              completionTokens: 20,
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const result = await webAIService.reviewPublication({
      title: "Test",
      markdown: "Esta es una prueva.",
      bodyText: "Esta es una prueva.",
      sourceHash: "hash-1",
      correctionBlock: {
        id: "block-1",
        text: "Esta es una prueva.",
        hash: "hash-1",
      },
    })

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      summary: "One correction.",
      language: "es",
      corrections: [
        {
          blockId: "block-1",
          replacementText: "prueba",
        },
      ],
      uncertain: [
        {
          text: "Artifact Studio",
        },
      ],
      usage: {
        model: "web-route",
        promptTokens: 120,
        completionTokens: 20,
      },
    })
  })

  it("hydrates correction blocks through the service envelope without leaking route details", async () => {
    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      lifecycle: "server-confirmed",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "persisted-1",
                writingId: "writing-1",
                blockId: "block-1",
                blockHash: "hash-1",
                suggestions: [],
                model: "gpt-test",
                createdAt: "2026-05-27T00:00:00.000Z",
                latencyMs: 120,
                promptTokens: 11,
                completionTokens: 7,
                syncedAt: "2026-05-27T00:00:01.000Z",
              },
            ],
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const result = await webAIService.hydrateCorrectionBlocks("writing-1")

    expect(result.error).toBeNull()
    expect(result.data).toEqual([
      expect.objectContaining({
        id: "persisted-1",
        writingId: "writing-1",
        blockId: "block-1",
      }),
    ])
  })

  it("returns empty array without remote call for local-only writings in hydrateCorrectionBlocks", async () => {
    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      lifecycle: "local-only",
    })

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await webAIService.hydrateCorrectionBlocks("writing-1")

    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns empty array without remote call for syncing writings in hydrateCorrectionBlocks", async () => {
    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      lifecycle: "syncing",
    })

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await webAIService.hydrateCorrectionBlocks("writing-1")

    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("blocks suggestTitle for local-only writings when writingId is provided", async () => {
    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      lifecycle: "local-only",
    })

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled",
      bodyText: "Some text.",
      writingId: "writing-1",
    })

    expect(result.error).toEqual({
      code: "INVALID_INPUT",
      message: expect.stringContaining("local-only"),
      retryable: false,
    })
    expect(result.data).toBeNull()
  })

  it("blocks suggestTitle for syncing writings when writingId is provided", async () => {
    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      lifecycle: "syncing",
    })

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled",
      bodyText: "Some text.",
      writingId: "writing-1",
    })

    expect(result.error).toEqual({
      code: "INVALID_INPUT",
      message: expect.stringContaining("syncing"),
      retryable: false,
    })
    expect(result.data).toBeNull()
  })

  it("allows suggestTitle for server-confirmed writings when writingId is provided", async () => {
    localDBMock.writings.get.mockResolvedValue({
      id: "writing-1",
      lifecycle: "server-confirmed",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: { title: "Allowed", rationale: "OK" },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const result = await webAIService.suggestTitle({
      currentTitle: "Untitled",
      bodyText: "Some text.",
      writingId: "writing-1",
    })

    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      title: "Allowed",
      rationale: "OK",
    })
  })
})

describe("webAuthService", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    supabaseAuthMock.signInWithPassword.mockReset()
    supabaseAuthMock.signUp.mockReset()
    supabaseAuthMock.signOut.mockReset()
    supabaseAuthMock.getUser.mockReset()
  })

  it("authenticates through the Supabase browser adapter and returns a normalized session", async () => {
    supabaseAuthMock.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "writer@example.com",
          new_email: null,
          email_confirmed_at: "2026-05-01T00:00:00.000Z",
          user_metadata: {
            display_name: "Writer",
            username: "writer",
          },
        },
      },
      error: null,
    })

    const result = await webAuthService.signIn({
      email: " Writer@Example.com ",
      password: "secret-123",
    })

    expect(supabaseAuthMock.signInWithPassword).toHaveBeenCalledWith({
      email: "writer@example.com",
      password: "secret-123",
    })
    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      status: "authenticated",
      user: {
        id: "user-1",
        email: "writer@example.com",
        pendingEmail: null,
        emailConfirmedAt: "2026-05-01T00:00:00.000Z",
        displayName: "Writer",
        username: "writer",
      },
    })
  })

  it("creates accounts through the auth adapter and reports pending confirmation", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://app.odessay.com",
      },
    })

    supabaseAuthMock.signUp.mockResolvedValue({
      data: {
        session: null,
        user: {
          id: "user-2",
          email: "new@example.com",
          new_email: null,
          email_confirmed_at: null,
          user_metadata: {
            display_name: "New Writer",
            username: "new_writer",
          },
        },
      },
      error: null,
    })

    const result = await webAuthService.signUp({
      displayName: "New Writer",
      username: "new_writer",
      email: "new@example.com",
      password: "secret-123",
      nextPath: "/desk",
    })

    expect(supabaseAuthMock.signUp).toHaveBeenCalledTimes(1)
    expect(supabaseAuthMock.signUp.mock.calls[0]?.[0]).toMatchObject({
      email: "new@example.com",
      options: {
        data: {
          display_name: "New Writer",
          username: "new_writer",
        },
        emailRedirectTo: "https://app.odessay.com/auth/confirm?next=%2Fdesk",
      },
    })
    expect(result.error).toBeNull()
    expect(result.data?.requiresEmailConfirmation).toBe(true)
  })

  it("checks username availability through the selected web route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)

        if (url.includes("/api/user/update-username")) {
          return new Response(
            JSON.stringify({
              data: {
                available: true,
                reason: "current",
                reservedUntil: null,
                username: "writer",
              },
              error: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }

        return new Response(
          JSON.stringify({
            data: {
              available: false,
              username: "taken_name",
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }),
    )

    const signupCheck = await webAuthService.checkUsernameAvailability({
      username: "taken_name",
      scope: "signup",
    })
    const accountCheck = await webAuthService.checkUsernameAvailability({
      username: "writer",
      scope: "account",
    })

    expect(signupCheck.data).toEqual({
      available: false,
      reason: "taken",
      reservedUntil: null,
      username: "taken_name",
    })
    expect(accountCheck.data).toEqual({
      available: true,
      reason: "current",
      reservedUntil: null,
      username: "writer",
    })
  })

  it("signs out through the Supabase browser adapter", async () => {
    supabaseAuthMock.signOut.mockResolvedValue({
      error: null,
    })

    const result = await webAuthService.signOut()

    expect(supabaseAuthMock.signOut).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      data: null,
      error: null,
    })
  })
})
