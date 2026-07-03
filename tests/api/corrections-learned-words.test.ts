import { beforeEach, describe, expect, it, vi } from "vitest"
import { DELETE, GET, POST } from "@/app/api/corrections/learned-words/route"

const supabaseAuthMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const selectLimitMock = vi.hoisted(() => vi.fn())
const upsertSingleMock = vi.hoisted(() => vi.fn())
const deleteMaybeSingleMock = vi.hoisted(() => vi.fn())

const adminFromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table !== "learned_words") {
      throw new Error(`Unexpected table: ${table}`)
    }

    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: selectLimitMock,
          })),
        })),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: upsertSingleMock,
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: deleteMaybeSingleMock,
            })),
          })),
        })),
      })),
    }
  }),
)

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: vi.fn(async () => {
    const result = await supabaseAuthMock.getUser()
    return { userId: result.data?.user?.id ?? null }
  }),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: adminFromMock,
  })),
}))

describe("/api/corrections/learned-words", () => {
  beforeEach(() => {
    supabaseAuthMock.getUser.mockReset()
    selectLimitMock.mockReset()
    upsertSingleMock.mockReset()
    deleteMaybeSingleMock.mockReset()
    adminFromMock.mockClear()
  })

  it("lists learned words for the current user", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    selectLimitMock.mockResolvedValue({
      data: [
        {
          id: "lw-1",
          word: "odessay",
          language: "unknown",
          created_at: "2026-07-03T00:00:00.000Z",
        },
      ],
      error: null,
    })

    const response = await GET(
      new Request("https://app.odessay.com/api/corrections/learned-words?limit=20"),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data.items).toEqual([
      {
        id: "lw-1",
        word: "odessay",
        language: "unknown",
        createdAt: "2026-07-03T00:00:00.000Z",
      },
    ])
    expect(body.data.nextCursor).toBeNull()
  })

  it("normalizes and saves a learned word", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    upsertSingleMock.mockResolvedValue({
      data: {
        id: "lw-1",
        word: "odessay ai",
        language: "unknown",
        created_at: "2026-07-03T00:00:00.000Z",
      },
      error: null,
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/corrections/learned-words", {
        method: "POST",
        body: JSON.stringify({ word: "Odéssay   AI" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.word).toBe("odessay ai")
  })

  it("deletes only the current user's learned word", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    deleteMaybeSingleMock.mockResolvedValue({
      data: { id: "lw-1" },
      error: null,
    })

    const response = await DELETE(
      new Request("https://app.odessay.com/api/corrections/learned-words", {
        method: "DELETE",
        body: JSON.stringify({ id: "cb8256fb-69af-4be2-b32d-918743b3bc2f" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.deletedId).toBe("lw-1")
  })
})
