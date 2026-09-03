import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, PATCH } from "@/app/api/user/settings/route"
import type { VocabularyItem } from "@/lib/vocabulary/types"

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

const vocabularyServerMock = vi.hoisted(() => ({
  listVocabulary: vi.fn(),
  setDisabledStatuses: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: supabaseMock,
  })),
}))

vi.mock("@/lib/vocabulary/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vocabulary/server")>("@/lib/vocabulary/server")
  return {
    ...actual,
    listVocabulary: vocabularyServerMock.listVocabulary,
    setDisabledStatuses: vocabularyServerMock.setDisabledStatuses,
  }
})

function statusItem(key: string, hidden: boolean): VocabularyItem {
  return {
    id: `base:status:${key}`,
    kind: "status",
    key,
    name: key,
    description: "",
    icon: "circle",
    color: "#8E837B",
    hidden,
    isBase: true,
    isRequired: key === "draft",
    position: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

describe("GET /api/user/settings", () => {
  beforeEach(() => {
    supabaseMock.getUser.mockReset()
    vocabularyServerMock.listVocabulary.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("derives disabledStatuses from hidden status vocabulary items", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.listVocabulary.mockResolvedValue({
      data: [statusItem("draft", false), statusItem("archived", true), statusItem("canceled", true)],
      error: null,
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.disabledStatuses.sort()).toEqual(["archived", "canceled"])
    expect(body.data.vocabulary).toHaveLength(3)
  })

  it("returns 500 with DB_ERROR when the vocabulary read fails", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.listVocabulary.mockResolvedValue({
      data: null,
      error: { code: "DB_ERROR", message: "connection reset", retryable: true },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe("DB_ERROR")
  })
})

describe("PATCH /api/user/settings", () => {
  beforeEach(() => {
    supabaseMock.getUser.mockReset()
    vocabularyServerMock.setDisabledStatuses.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } })

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

  it("rejects draft in disabled_statuses at the schema level", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

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
    expect(vocabularyServerMock.setDisabledStatuses).not.toHaveBeenCalled()
  })

  it("accepts valid disabled_statuses without draft", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.setDisabledStatuses.mockResolvedValue({
      data: [statusItem("draft", false), statusItem("archived", true), statusItem("canceled", true)],
      error: null,
    })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["archived", "canceled"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.disabledStatuses.sort()).toEqual(["archived", "canceled"])
    expect(vocabularyServerMock.setDisabledStatuses).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      ["archived", "canceled"],
    )
  })

  it("returns 400 when no fields are provided", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

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

  it("propagates INVALID_INPUT from the vocabulary layer as 400", async () => {
    supabaseMock.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    vocabularyServerMock.setDisabledStatuses.mockResolvedValue({
      data: null,
      error: { code: "INVALID_INPUT", message: "draft cannot be disabled", retryable: false },
    })

    const response = await PATCH(
      new Request("https://app.odessay.com/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify({ disabled_statuses: ["archived"] }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("INVALID_INPUT")
  })
})
