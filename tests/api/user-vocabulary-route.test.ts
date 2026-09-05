import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, POST } from "@/app/api/user/vocabulary/route"
import { DELETE, PATCH } from "@/app/api/user/vocabulary/[id]/route"
import type { VocabularyItem } from "@/lib/vocabulary/types"

const supabaseMock = vi.hoisted(() => ({ getUser: vi.fn() }))

const vocabularyServerMock = vi.hoisted(() => ({
  listVocabulary: vi.fn(),
  createVocabularyItem: vi.fn(),
  updateVocabularyItem: vi.fn(),
  deleteVocabularyItem: vi.fn(),
  getVocabularyUsage: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: supabaseMock })),
}))

vi.mock("@/lib/vocabulary/server", () => vocabularyServerMock)

const item: VocabularyItem = {
  id: "row-1",
  kind: "type",
  key: "research",
  name: "Research",
  description: "",
  icon: "compass",
  color: "#5B5BD6",
  hidden: false,
  isBase: false,
  isRequired: false,
  position: 7,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
}

function resetAll() {
  supabaseMock.getUser.mockReset()
  Object.values(vocabularyServerMock).forEach((fn) => fn.mockReset())
}

describe("GET /api/user/vocabulary", () => {
  beforeEach(resetAll)

  it("returns 401 without a session", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })
    const response = await GET(new Request("https://app.odessay.com/api/user/vocabulary"))
    expect(response.status).toBe(401)
  })

  it("returns the vocabulary list", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.listVocabulary.mockResolvedValue({ data: [item], error: null })

    const response = await GET(new Request("https://app.odessay.com/api/user/vocabulary"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.items).toEqual([item])
    expect(vocabularyServerMock.getVocabularyUsage).not.toHaveBeenCalled()
  })

  it("includes usage counts when ?usage=1", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.listVocabulary.mockResolvedValue({ data: [item], error: null })
    vocabularyServerMock.getVocabularyUsage.mockResolvedValue({ data: { "row-1": 4 }, error: null })

    const response = await GET(new Request("https://app.odessay.com/api/user/vocabulary?usage=1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.usage).toEqual({ "row-1": 4 })
  })
})

describe("POST /api/user/vocabulary", () => {
  beforeEach(resetAll)

  it("returns 400 on malformed input", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    const response = await POST(
      new Request("https://app.odessay.com/api/user/vocabulary", {
        method: "POST",
        body: JSON.stringify({ kind: "type" }),
      }),
    )
    expect(response.status).toBe(400)
    expect(vocabularyServerMock.createVocabularyItem).not.toHaveBeenCalled()
  })

  it("creates an item and returns 201", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.createVocabularyItem.mockResolvedValue({ data: item, error: null })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/vocabulary", {
        method: "POST",
        body: JSON.stringify({ kind: "type", name: "Research", icon: "compass", color: "#5B5BD6" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toEqual(item)
  })

  it("maps INVALID_INPUT from the service to a 400", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.createVocabularyItem.mockResolvedValue({
      data: null,
      error: { code: "INVALID_INPUT", message: "Name cannot be empty.", retryable: false },
    })

    const response = await POST(
      new Request("https://app.odessay.com/api/user/vocabulary", {
        method: "POST",
        body: JSON.stringify({ kind: "type", name: "x", icon: "compass", color: "#5B5BD6" }),
      }),
    )
    expect(response.status).toBe(400)
  })
})

describe("PATCH /api/user/vocabulary/[id]", () => {
  beforeEach(resetAll)

  it("returns 401 without a session", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })
    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/vocabulary/row-1", { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ id: "row-1" }) },
    )
    expect(response.status).toBe(401)
  })

  it("updates an item", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.updateVocabularyItem.mockResolvedValue({ data: { ...item, name: "Renamed" }, error: null })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/vocabulary/row-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: Promise.resolve({ id: "row-1" }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.name).toBe("Renamed")
    expect(vocabularyServerMock.updateVocabularyItem).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "row-1",
      { name: "Renamed" },
    )
  })
})

describe("DELETE /api/user/vocabulary/[id]", () => {
  beforeEach(resetAll)

  it("rejects deleting a base item with 400 and does not touch data", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.deleteVocabularyItem.mockResolvedValue({
      data: null,
      error: { code: "INVALID_INPUT", message: '"General" is a base item and cannot be deleted.', retryable: false },
    })

    const response = await DELETE(
      new Request("https://app.odessay.com/api/user/vocabulary/base:type:general", { method: "DELETE" }),
      { params: Promise.resolve({ id: "base:type:general" }) },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain("base item")
  })

  it("deletes a custom item and returns the rewritten count", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.deleteVocabularyItem.mockResolvedValue({
      data: { rewrittenCount: 5 },
      error: null,
    })

    const response = await DELETE(
      new Request("https://app.odessay.com/api/user/vocabulary/row-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "row-1" }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ rewrittenCount: 5 })
  })
})
