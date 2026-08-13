import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/corrections/persist/route"

const supabaseAuthMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const ownershipMaybeSingleMock = vi.hoisted(() => vi.fn())
const persistedBlocksEqMock = vi.hoisted(() => vi.fn())
const persistedBlocksOrderMock = vi.hoisted(() => vi.fn())
const persistedBlocksLimitMock = vi.hoisted(() => vi.fn())
const deleteInMock = vi.hoisted(() => vi.fn())
const upsertSingleMock = vi.hoisted(() => vi.fn())

const adminFromMock = vi.hoisted(() =>
  vi.fn((table: string) => {
    if (table === "writings") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: ownershipMaybeSingleMock,
            })),
          })),
        })),
      }
    }

    if (table === "correction_blocks") {
      return {
        select: vi.fn(() => ({
          eq: (...args: unknown[]) => {
            persistedBlocksEqMock(...args)
            return {
              order: (...orderArgs: unknown[]) => {
                persistedBlocksOrderMock(...orderArgs)
                return { limit: persistedBlocksLimitMock }
              },
            }
          },
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: deleteInMock,
          })),
        })),
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: upsertSingleMock,
          })),
        })),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
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

const createRequest = (body: Record<string, unknown>) =>
  new Request("https://app.odessay.com/api/corrections/persist", {
    method: "POST",
    body: JSON.stringify(body),
  })

describe("POST /api/corrections/persist", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    supabaseAuthMock.getUser.mockReset()
    ownershipMaybeSingleMock.mockReset()
    persistedBlocksEqMock.mockReset()
    persistedBlocksOrderMock.mockReset()
    persistedBlocksLimitMock.mockReset()
    deleteInMock.mockReset()
    upsertSingleMock.mockReset()
    adminFromMock.mockClear()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await POST(
      createRequest({
        writingId: "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab",
        deletedBlockIds: ["auto-correction:w:blk"],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("returns 403 when the writing is not owned by the current user", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    ownershipMaybeSingleMock.mockResolvedValue({ data: null, error: null })

    const response = await POST(
      createRequest({
        writingId: "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab",
        deletedBlockIds: ["auto-correction:w:blk"],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe("FORBIDDEN")
  })

  it("upserts a correction block and deletes stale ids for the same writing", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    ownershipMaybeSingleMock.mockResolvedValue({ data: { id: "writing-1" }, error: null })
    persistedBlocksLimitMock.mockResolvedValue({ data: [], error: null })
    deleteInMock.mockResolvedValue({ error: null })
    upsertSingleMock.mockResolvedValue({ data: { id: "auto-correction:writing-1:blk-1" }, error: null })

    const response = await POST(
      createRequest({
        writingId: "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab",
        deletedBlockIds: ["auto-correction:writing-1:blk-old"],
        block: {
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
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data.persistedId).toBe("auto-correction:writing-1:blk-1")
    expect(body.data.deletedIds).toEqual(["auto-correction:writing-1:blk-old"])
    expect(deleteInMock).toHaveBeenCalledWith("id", ["auto-correction:writing-1:blk-old"])
    expect(upsertSingleMock).toHaveBeenCalledTimes(1)
    // ODE-389: the stale-candidate scan must stay bounded, newest blocks first.
    expect(persistedBlocksOrderMock).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(persistedBlocksLimitMock).toHaveBeenCalledWith(500)
  })

  it("deletes stale logical versions when the same block shifts position after a manual edit", async () => {
    supabaseAuthMock.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    })
    ownershipMaybeSingleMock.mockResolvedValue({ data: { id: "writing-1" }, error: null })
    persistedBlocksLimitMock.mockResolvedValue({
      data: [
        {
          id: "auto-correction:writing-1:blk-old",
          block_id: "correction-block:0.3:blk-old:236",
          block_hash: "blk-old",
        },
        {
          id: "auto-correction:writing-1:blk-other",
          block_id: "correction-block:0.4:blk-other:240",
          block_hash: "blk-other",
        },
      ],
      error: null,
    })
    deleteInMock.mockResolvedValue({ error: null })
    upsertSingleMock.mockResolvedValue({ data: { id: "auto-correction:writing-1:blk-new" }, error: null })

    const response = await POST(
      createRequest({
        writingId: "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab",
        block: {
          id: "auto-correction:writing-1:blk-new",
          writing_id: "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab",
          block_id: "correction-block:0.3:blk-new:237",
          block_hash: "blk-new",
          suggestions: [],
          model: "test-model",
          created_at: "2026-05-19T00:00:00.000Z",
          latency_ms: 120,
          prompt_tokens: 12,
          completion_tokens: 4,
        },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data.persistedId).toBe("auto-correction:writing-1:blk-new")
    expect(body.data.deletedIds).toEqual(["auto-correction:writing-1:blk-old"])
    expect(deleteInMock).toHaveBeenCalledWith("id", ["auto-correction:writing-1:blk-old"])
  })
})
