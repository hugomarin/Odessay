import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/writings/route"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())

const supabaseAdminMock = vi.hoisted(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({ data: [], error: null })),
      })),
    })),
  })),
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => supabaseAdminMock),
}))

describe("GET /api/writings", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    supabaseAdminMock.from.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })

    const response = await GET(new Request("http://localhost/api/writings"))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "No active session.",
    })
  })

  it("selects only metadata columns without body_json or body_text", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })

    const orderMock = vi.fn(() => ({
      data: [
        {
          id: "w1",
          author_id: "user-1",
          title: "Title",
          slug: "title",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    }))

    const eqMock = vi.fn(() => ({ order: orderMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    const fromMock = vi.fn(() => ({ select: selectMock }))
    supabaseAdminMock.from.mockImplementation(fromMock as unknown as typeof supabaseAdminMock.from)

    const response = await GET(new Request("http://localhost/api/writings"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).not.toHaveProperty("body_json")
    expect(body.data[0]).not.toHaveProperty("body_text")
    expect(body.data[0].title).toBe("Title")

    // Verify the select string excludes body fields
    const firstCall = selectMock.mock.calls[0] as unknown as [string]
    const selectCall = firstCall?.[0] ?? ""
    expect(selectCall).toContain("id")
    expect(selectCall).toContain("title")
    expect(selectCall).not.toContain("body_json")
    expect(selectCall).not.toContain("body_text")
  })

  it("does not include body_json or body_text in any row of the response", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })

    const orderMock = vi.fn(() => ({
      data: [
        {
          id: "w1",
          author_id: "user-1",
          title: "A",
          slug: "a",
          status: "draft",
          visibility: "private",
          parent_id: null,
          correspondence_id: null,
          version: 1,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "w2",
          author_id: "user-1",
          title: "B",
          slug: "b",
          status: "done",
          visibility: "public",
          parent_id: null,
          correspondence_id: null,
          version: 2,
          sync_status: "synced",
          deleted_at: null,
          created_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      error: null,
    }))

    const eqMock = vi.fn(() => ({ order: orderMock }))
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    const fromMock = vi.fn(() => ({ select: selectMock }))
    supabaseAdminMock.from.mockImplementation(fromMock as unknown as typeof supabaseAdminMock.from)

    const response = await GET(new Request("http://localhost/api/writings"))
    const body = await response.json()

    expect(response.status).toBe(200)
    for (const row of body.data) {
      expect(row).not.toHaveProperty("body_json")
      expect(row).not.toHaveProperty("body_text")
    }
  })
})
