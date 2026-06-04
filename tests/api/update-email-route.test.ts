import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/user/update-email/route"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: supabaseMock,
  })),
}))

describe("POST /api/user/update-email", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com"
    supabaseMock.getUser.mockReset()
    supabaseMock.updateUser.mockReset()
  })

  it("uses Supabase Auth native secure email change flow", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          email: "current@example.com",
          email_confirmed_at: "2026-05-12T00:00:00.000Z",
          new_email: null,
          email_change_sent_at: null,
        },
      },
    })
    supabaseMock.updateUser.mockResolvedValue({ error: null })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ data: { email: "new@example.com" }, error: null })
    expect(supabaseMock.updateUser).toHaveBeenCalledWith(
      { email: "new@example.com" },
      { emailRedirectTo: "https://app.odessay.com/auth/confirm?next=%2Fsettings%2Faccount" },
    )
  })

  it("returns 401 when there is no active session", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "No active session.",
    })
    expect(supabaseMock.updateUser).not.toHaveBeenCalled()
  })

  it("returns 409 when current email is not confirmed", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          email: "current@example.com",
          email_confirmed_at: null,
          new_email: null,
          email_change_sent_at: null,
        },
      },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toEqual({
      code: "EMAIL_NOT_CONFIRMED",
      message: "Confirm your current email before requesting another change.",
    })
    expect(supabaseMock.updateUser).not.toHaveBeenCalled()
  })

  it("returns 409 when an email change is already pending", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          email: "current@example.com",
          email_confirmed_at: "2026-05-12T00:00:00.000Z",
          new_email: "pending@example.com",
          email_change_sent_at: "2026-05-12T00:00:00.000Z",
        },
      },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toEqual({
      code: "EMAIL_CHANGE_PENDING",
      message: "You already have a pending email change. Confirm or revoke it from your inbox first.",
    })
    expect(supabaseMock.updateUser).not.toHaveBeenCalled()
  })

  it("returns 400 when the new email matches the current email", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          email: "current@example.com",
          email_confirmed_at: "2026-05-12T00:00:00.000Z",
          new_email: null,
          email_change_sent_at: null,
        },
      },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "current@example.com" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toEqual({
      code: "NO_CHANGES",
      message: "Use a different email address.",
    })
    expect(supabaseMock.updateUser).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid email input", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          email: "current@example.com",
          email_confirmed_at: "2026-05-12T00:00:00.000Z",
          new_email: null,
          email_change_sent_at: null,
        },
      },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toEqual({
      code: "INVALID_INPUT",
      message: expect.any(String),
    })
    expect(supabaseMock.updateUser).not.toHaveBeenCalled()
  })

  it("returns the Supabase Auth error without sending app-owned auth email", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: {
        user: {
          email: "current@example.com",
          email_confirmed_at: "2026-05-12T00:00:00.000Z",
          new_email: null,
          email_change_sent_at: null,
        },
      },
    })
    supabaseMock.updateUser.mockResolvedValue({
      error: { message: "Email rate limit exceeded" },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/update-email", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toEqual({
      code: "EMAIL_CHANGE_FAILED",
      message: "Email rate limit exceeded",
    })
    expect(supabaseMock.updateUser).toHaveBeenCalledTimes(1)
  })
})
