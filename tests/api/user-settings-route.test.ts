import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, PATCH } from "@/app/api/user/settings/route"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const supabaseFromMock = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: supabaseMock,
    from: vi.fn(() => supabaseFromMock),
  })),
}))

describe("GET /api/user/settings", () => {
  beforeEach(() => {
    supabaseMock.getUser.mockReset()
    supabaseFromMock.select.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("returns disabled statuses for authenticated user", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    supabaseFromMock.select.mockImplementation(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => ({
          data: { disabled_statuses: ["archived", "canceled"] },
          error: null,
        })),
      })),
    }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.disabledStatuses).toEqual(["archived", "canceled"])
  })

  it("returns empty array when disabled_statuses column is missing", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    supabaseFromMock.select.mockImplementation(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => ({
          data: null,
          error: { message: "column profiles.disabled_statuses does not exist" },
        })),
      })),
    }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.disabledStatuses).toEqual([])
  })
})

describe("PATCH /api/user/settings", () => {
  beforeEach(() => {
    supabaseMock.getUser.mockReset()
    supabaseFromMock.select.mockReset()
    supabaseFromMock.update.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["archived"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("rejects draft in disabled_statuses", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["draft", "archived"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("INVALID_INPUT")
    expect(body.error.message).toContain("draft cannot be disabled")
  })

  it("rejects draft alone in disabled_statuses", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["draft"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("INVALID_INPUT")
  })

  it("accepts valid disabled_statuses without draft", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    supabaseFromMock.update.mockImplementation(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => ({
            data: { disabled_statuses: ["archived", "canceled"] },
            error: null,
          })),
        })),
      })),
    }))

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["archived", "canceled"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.disabledStatuses).toEqual(["archived", "canceled"])
  })

  it("returns 400 when no fields are provided", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("INVALID_INPUT")
  })

  it("returns 503 when disabled_statuses column is missing", async () => {
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })

    supabaseFromMock.update.mockImplementation(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => ({
            data: null,
            error: { message: "column profiles.disabled_statuses does not exist" },
          })),
        })),
      })),
    }))

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["archived"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error.code).toBe("SCHEMA_OUTDATED")
  })
})
