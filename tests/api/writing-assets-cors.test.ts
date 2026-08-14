/**
 * The desktop editor resolves image sources from `tauri://localhost`. Without
 * CORS on this route the authenticated fetch dies in preflight, the resolver
 * falls back to the bare API URL as an <img> src — which sends no credentials —
 * and the writer sees a broken image with no explanation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, OPTIONS } from "@/app/api/writing-assets/[assetId]/route"

const assetId = "5ab51961-35b5-45ef-a48e-aee9417a15d8"
const writingId = "bf3df177-5fce-49e4-b160-986e7f36f824"
const authorId = "1c221614-73c8-4bc9-84a9-9a19d667ee56"
const signedUrl = "https://project.supabase.co/storage/v1/object/sign/writing-assets/a.png?token=x"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())
const createAdminClientMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}))

function adminClient({ visibility = "private" } = {}) {
  const rows: Record<string, unknown> = {
    writing_assets: { writing_id: writingId, storage_path: "a.png", author_id: authorId },
    writings: { author_id: authorId, visibility },
  }
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: rows[table], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    }),
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl }, error: null }) }),
    },
  }
}

function tauriRequest(init: RequestInit = {}) {
  return new Request(`https://odessay.vercel.app/api/writing-assets/${assetId}`, {
    ...init,
    headers: { ...(init.headers ?? {}), origin: "tauri://localhost" },
  })
}

const params = Promise.resolve({ assetId })

function expectCors(response: Response) {
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost")
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization")
}

describe("CORS for the desktop image asset route", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    createAdminClientMock.mockReset()
  })

  it("answers the preflight the desktop sends before an authorized GET", () => {
    expectCors(OPTIONS(tauriRequest({ method: "OPTIONS" })))
  })

  it("keeps CORS headers on the redirect to the signed storage URL", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: authorId })
    createAdminClientMock.mockReturnValue(adminClient())

    const response = await GET(tauriRequest(), { params })

    // Response.redirect() would make the headers immutable — the CORS headers
    // must survive on the redirect itself, not only on the final hop.
    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe(signedUrl)
    expectCors(response)
  })

  it("keeps CORS headers on a denial, so the desktop reads the reason", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
    createAdminClientMock.mockReturnValue(adminClient())

    const response = await GET(tauriRequest(), { params })

    expect(response.status).toBe(403)
    expectCors(response)
  })

  it("does not hand CORS headers to an unknown origin", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: authorId })
    createAdminClientMock.mockReturnValue(adminClient())

    const request = new Request(`https://odessay.vercel.app/api/writing-assets/${assetId}`, {
      headers: { origin: "https://evil.example" },
    })
    const response = await GET(request, { params })

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
