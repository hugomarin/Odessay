import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  GET as getShares,
  POST as postShares,
  DELETE as deleteShares,
  OPTIONS as optionsShares,
} from "@/app/api/writings/[id]/shares/route"
import {
  GET as getPreview,
  POST as postPreview,
  DELETE as deletePreview,
  OPTIONS as optionsPreview,
} from "@/app/api/writings/[id]/share-test-link/route"

const writingId = "7d26d0d8-f3c8-4b98-94d4-4bb5f6d2f9ab"
const userId = "user-1"
const sharedWithUserId = "9c839e0a-487c-494e-b238-7faf68eec1d3"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())
const createWebSharingServiceMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/services/web-sharing-service", () => ({
  createWebSharingService: createWebSharingServiceMock,
}))

function tauriRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      origin: "tauri://localhost",
    },
  })
}

function expectCors(response: Response, origin = "tauri://localhost") {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin)
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  const methods = response.headers.get("Access-Control-Allow-Methods")
  expect(methods).toContain("GET")
  expect(methods).toContain("POST")
  expect(methods).toContain("DELETE")
  expect(methods).toContain("OPTIONS")
  const allowedHeaders = response.headers.get("Access-Control-Allow-Headers")
  expect(allowedHeaders).toContain("Content-Type")
  expect(allowedHeaders).toContain("Authorization")
}

describe("CORS for desktop sharing routes", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    createWebSharingServiceMock.mockReset()
  })

  describe("/api/writings/[id]/shares", () => {
    const baseUrl = `https://app.odessay.com/api/writings/${writingId}/shares`

    it("responds to OPTIONS with CORS headers for tauri://localhost", async () => {
      const response = await optionsShares(tauriRequest(baseUrl, { method: "OPTIONS" }))
      expect(response.status).toBe(204)
      expectCors(response)
    })

    it("includes CORS headers on 401 unauthorized responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
      const response = await getShares(tauriRequest(baseUrl), { params: Promise.resolve({ id: writingId }) })
      expect(response.status).toBe(401)
      expectCors(response)
      const body = await response.json()
      expect(body.error.code).toBe("UNAUTHORIZED")
    })

    it("includes CORS headers on successful GET responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId })
      createWebSharingServiceMock.mockResolvedValue({
        listRecipients: vi.fn(async () => ({ data: [], error: null })),
      })
      const response = await getShares(tauriRequest(baseUrl), { params: Promise.resolve({ id: writingId }) })
      expect(response.status).toBe(200)
      expectCors(response)
      const body = await response.json()
      expect(body.data).toEqual([])
    })

    it("includes CORS headers on successful POST responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId })
      createWebSharingServiceMock.mockResolvedValue({
        shareWriting: vi.fn(async () => ({ data: { userId: sharedWithUserId }, error: null })),
      })
      const response = await postShares(
        tauriRequest(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: sharedWithUserId }),
        }),
        { params: Promise.resolve({ id: writingId }) },
      )
      expect(response.status).toBe(201)
      expectCors(response)
    })

    it("includes CORS headers on successful DELETE responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId })
      createWebSharingServiceMock.mockResolvedValue({
        revokeShare: vi.fn(async () => ({ data: { writingId, sharedWithUserId }, error: null })),
      })
      const response = await deleteShares(
        tauriRequest(baseUrl, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_with_id: sharedWithUserId }),
        }),
        { params: Promise.resolve({ id: writingId }) },
      )
      expect(response.status).toBe(204)
      expectCors(response)
    })
  })

  describe("/api/writings/[id]/share-test-link", () => {
    const baseUrl = `https://app.odessay.com/api/writings/${writingId}/share-test-link`

    it("responds to OPTIONS with CORS headers for tauri://localhost", async () => {
      const response = await optionsPreview(tauriRequest(baseUrl, { method: "OPTIONS" }))
      expect(response.status).toBe(204)
      expectCors(response)
    })

    it("includes CORS headers on 401 unauthorized responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
      const response = await getPreview(tauriRequest(baseUrl), { params: Promise.resolve({ id: writingId }) })
      expect(response.status).toBe(401)
      expectCors(response)
      const body = await response.json()
      expect(body.error.code).toBe("UNAUTHORIZED")
    })

    it("includes CORS headers on successful GET responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId })
      createWebSharingServiceMock.mockResolvedValue({
        getPreviewLink: vi.fn(async () => ({ data: { active: false }, error: null })),
      })
      const response = await getPreview(tauriRequest(baseUrl), { params: Promise.resolve({ id: writingId }) })
      expect(response.status).toBe(200)
      expectCors(response)
    })

    it("includes CORS headers on successful POST responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId })
      createWebSharingServiceMock.mockResolvedValue({
        rotatePreviewLink: vi.fn(async () => ({ data: { active: true }, error: null })),
      })
      const response = await postPreview(tauriRequest(baseUrl, { method: "POST" }), {
        params: Promise.resolve({ id: writingId }),
      })
      expect(response.status).toBe(201)
      expectCors(response)
    })

    it("includes CORS headers on successful DELETE responses", async () => {
      getCurrentUserFromRequestMock.mockResolvedValue({ userId })
      createWebSharingServiceMock.mockResolvedValue({
        revokePreviewLink: vi.fn(async () => ({ data: { writingId, revoked: true }, error: null })),
      })
      const response = await deletePreview(tauriRequest(baseUrl, { method: "DELETE" }), {
        params: Promise.resolve({ id: writingId }),
      })
      expect(response.status).toBe(200)
      expectCors(response)
    })
  })

  it("does not add CORS headers for disallowed origins", async () => {
    const response = await optionsShares(
      new Request(`https://app.odessay.com/api/writings/${writingId}/shares`, { method: "OPTIONS" }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
