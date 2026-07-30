import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/writings/[id]/lifecycle/route"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())
const createClientMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}))

type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null }

function query(result: QueryResult) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ["eq", "not", "select"]) builder[method] = vi.fn(() => builder)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  return builder
}

function supabase(archivedResult: QueryResult, updateResult: QueryResult) {
  const archived = query(archivedResult)
  const update = query(updateResult)
  const updateCall = vi.fn(() => update)
  const deleteBuilder = query({ data: null, error: null })
  const deleteCall = vi.fn(() => deleteBuilder)
  const from = vi.fn(() => ({
    select: vi.fn(() => archived),
    update: updateCall,
    delete: deleteCall,
  }))
  return { client: { from }, archived, update, updateCall, delete: deleteBuilder, deleteCall }
}

function deleteRequest() {
  return new Request("http://localhost/api/writings/writing-1/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete-permanently" }),
  })
}

function restoreRequest(version = 4) {
  return new Request("http://localhost/api/writings/writing-1/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", version, updated_at: "2026-07-29T20:30:02.000Z" }),
  })
}

const context = { params: Promise.resolve({ id: "writing-1" }) }

describe("POST /api/writings/[id]/lifecycle", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    createClientMock.mockReset()
  })

  it("rejects an unauthenticated restore", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
    const response = await POST(restoreRequest(), context)
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe("UNAUTHORIZED")
  })

  it("rejects a stale restore before issuing an update", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "author-1" })
    const database = supabase({ data: { id: "writing-1", version: 5 }, error: null }, { data: null, error: null })
    createClientMock.mockResolvedValue(database.client)

    const response = await POST(restoreRequest(4), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.code).toBe("VERSION_CONFLICT")
    expect(database.updateCall).not.toHaveBeenCalled()
  })

  it("updates only the owner archived row at the expected version", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "author-1" })
    const restored = { id: "writing-1", author_id: "author-1", version: 5, deleted_at: null }
    const database = supabase({ data: { id: "writing-1", version: 4 }, error: null }, { data: restored, error: null })
    createClientMock.mockResolvedValue(database.client)

    const response = await POST(restoreRequest(4), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual(restored)
    expect(database.updateCall).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: null, version: 5 }))
    expect(database.update.eq).toHaveBeenCalledWith("id", "writing-1")
    expect(database.update.eq).toHaveBeenCalledWith("author_id", "author-1")
    expect(database.update.eq).toHaveBeenCalledWith("version", 4)
    expect(database.update.not).toHaveBeenCalledWith("deleted_at", "is", null)
  })

  it("returns a conflict if the conditional update loses a race", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "author-1" })
    const database = supabase({ data: { id: "writing-1", version: 4 }, error: null }, { data: null, error: null })
    createClientMock.mockResolvedValue(database.client)

    const response = await POST(restoreRequest(4), context)
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("VERSION_CONFLICT")
  })

  it("permanently deletes only the owner archived row", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "author-1" })
    const database = supabase({ data: { id: "writing-1", version: 2 }, error: null }, { data: null, error: null })
    createClientMock.mockResolvedValue(database.client)

    const response = await POST(deleteRequest(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ id: "writing-1" })
    expect(database.deleteCall).toHaveBeenCalled()
    expect(database.delete.eq).toHaveBeenCalledWith("id", "writing-1")
    expect(database.delete.eq).toHaveBeenCalledWith("author_id", "author-1")
    expect(database.delete.not).toHaveBeenCalledWith("deleted_at", "is", null)
  })
})
