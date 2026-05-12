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
      { emailRedirectTo: "https://app.odessay.com/settings/account" },
    )
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
