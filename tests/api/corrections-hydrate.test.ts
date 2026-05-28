import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/corrections/hydrate/route"

const supabaseAuthMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const ownershipMaybeSingleMock = vi.hoisted(() => vi.fn())
const correctionOrderMock = vi.hoisted(() => vi.fn())

const adminFromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "writings") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: ownershipMaybeSingleMock,
          })),
        })),
      }
    }

    if (table === "correction_blocks") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: correctionOrderMock,
          })),
        })),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  }),
)

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: supabaseAuthMock,
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: adminFromMock,
  })),
}))

describe("GET /api/corrections/hydrate", () => {
  beforeEach(() => {
    supabaseAuthMock.getUser.mockReset()
    ownershipMaybeSingleMock.mockReset()
    correctionOrderMock.mockReset()
    adminFromMock.mockClear()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await GET(
      new Request("https://app.odessay.com/api/corrections/hydrate?writingId=7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab"),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("returns 404 when the writing does not exist", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    ownershipMaybeSingleMock.mockResolvedValue({ data: null, error: null })

    const response = await GET(
      new Request("https://app.odessay.com/api/corrections/hydrate?writingId=7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab"),
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.code).toBe("NOT_FOUND")
  })

  it("returns 403 when the writing exists but is not owned by the user", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    ownershipMaybeSingleMock.mockResolvedValue({
      data: { id: "writing-1", author_id: "user-2" },
      error: null,
    })

    const response = await GET(
      new Request("https://app.odessay.com/api/corrections/hydrate?writingId=7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab"),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("hydrates persisted correction blocks for an owned writing", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    ownershipMaybeSingleMock.mockResolvedValue({ data: { id: "writing-1", author_id: "user-1" }, error: null })
    correctionOrderMock.mockResolvedValue({
      data: [
        {
          id: "auto-correction:writing-1:blk-1",
          writing_id: "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab",
          block_id: "correction-block:blk-1:12",
          block_hash: "blk-1",
          suggestions: [],
          model: "test-model",
          created_at: "2026-05-19T00:00:00.000Z",
          latency_ms: 120,
          prompt_tokens: 12,
          completion_tokens: 4,
        },
      ],
      error: null,
    })

    const response = await GET(
      new Request("https://app.odessay.com/api/corrections/hydrate?writingId=7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab"),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: "auto-correction:writing-1:blk-1",
      block_hash: "blk-1",
      model: "test-model",
    })
  })
})
