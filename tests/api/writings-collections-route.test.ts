import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, PUT } from "@/app/api/writings/[id]/collections/route"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ data: [] as unknown[], error: null })),
      })),
    })),
  })),
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: supabaseMock.rpc,
    from: supabaseMock.from,
  })),
}))

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/writings/writing-id/collections", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const WRITING_ID = "550e8400-e29b-41d4-a716-446655440000"
const COL_ID_1 = "660e8400-e29b-41d4-a716-446655440001"
const COL_ID_2 = "660e8400-e29b-41d4-a716-446655440002"
const USER_ID = "770e8400-e29b-41d4-a716-446655440003"

const makeContext = (id: string) => ({
  params: Promise.resolve({ id }),
})

describe("GET /api/writings/[id]/collections", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    supabaseMock.from.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })

    const response = await GET(
      new Request(`http://localhost/api/writings/${WRITING_ID}/collections`),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "No active session.",
    })
  })

  it("returns writing collections for the authenticated user", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    const eqInnerMock = vi.fn(() => ({
      data: [{ collection_id: "col-1", added_at: "2026-01-01T00:00:00.000Z" }],
      error: null,
    }))

    const eqMock = vi.fn(() => ({
      eq: eqInnerMock,
    }))

    const selectMock = vi.fn(() => ({
      eq: eqMock,
    }))

    supabaseMock.from.mockImplementation(() => ({
      select: selectMock,
    }))

    const response = await GET(
      new Request(`http://localhost/api/writings/${WRITING_ID}/collections`),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data).toEqual([
      { collection_id: "col-1", added_at: "2026-01-01T00:00:00.000Z" },
    ])
  })
})

describe("PUT /api/writings/[id]/collections", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    supabaseMock.rpc.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })

    const response = await PUT(
      makeRequest({ collection_ids: [COL_ID_1], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "No active session.",
    })
  })

  it("returns 400 for invalid input", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    const response = await PUT(
      makeRequest({ collection_ids: "not-an-array" }),
      makeContext("writing-id"),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("INVALID_INPUT")
  })

  it("returns 404 when the writing does not exist (PT404)", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: "PT404", message: "Writing not found." },
    })

    const response = await PUT(
      makeRequest({ collection_ids: [COL_ID_1], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toEqual({
      code: "NOT_FOUND",
      message: "Writing not found.",
    })
  })

  it("returns 403 when a collection does not belong to the user (PT403)", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: "PT403", message: "One or more collections do not belong to the active user." },
    })

    const response = await PUT(
      makeRequest({ collection_ids: [COL_ID_1], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toEqual({
      code: "FORBIDDEN",
      message: "One or more collections do not belong to the active user.",
    })
  })

  it("returns 200 and replaces collection membership on success", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    })

    const response = await PUT(
      makeRequest({ collection_ids: [COL_ID_1, COL_ID_2], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data).toEqual({
      writing_id: WRITING_ID,
      collection_ids: [COL_ID_1, COL_ID_2],
    })

    expect(supabaseMock.rpc).toHaveBeenCalledWith("replace_writing_collections", {
      p_writing_id: WRITING_ID,
      p_collection_ids: [COL_ID_1, COL_ID_2],
      p_added_at: "2026-01-01T00:00:00.000Z",
    })
  })

  it("deduplicates collection ids before calling rpc", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    })

    const response = await PUT(
      makeRequest({ collection_ids: [COL_ID_1, COL_ID_1, COL_ID_2], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.collection_ids).toEqual([COL_ID_1, COL_ID_2])

    const rpcCall = supabaseMock.rpc.mock.calls[0] as unknown as [string, object]
    const params = rpcCall?.[1] as { p_collection_ids: string[] }
    expect(params.p_collection_ids).toEqual([COL_ID_1, COL_ID_2])
  })

  it("returns 500 for unexpected DB errors", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "Some unexpected DB error" },
    })

    const response = await PUT(
      makeRequest({ collection_ids: [COL_ID_1], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe("DB_ERROR")
  })

  it("removes all collections when collection_ids is empty", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: USER_ID })

    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    })

    const response = await PUT(
      makeRequest({ collection_ids: [], updated_at: "2026-01-01T00:00:00.000Z" }),
      makeContext(WRITING_ID),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.collection_ids).toEqual([])
  })
})
