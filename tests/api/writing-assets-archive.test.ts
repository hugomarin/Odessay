/**
 * ODE-523 — an archived writing's former visibility must not keep minting
 * signed asset URLs for third parties. Normal writing reads already exclude
 * archived rows; this route was the one place that didn't check deleted_at.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/writing-assets/[assetId]/route"

const assetId = "5ab51961-35b5-45ef-a48e-aee9417a15d8"
const writingId = "bf3df177-5fce-49e4-b160-986e7f36f824"
const authorId = "1c221614-73c8-4bc9-84a9-9a19d667ee56"
const strangerId = "00000000-0000-4000-8000-000000000099"
const signedUrl = "https://project.supabase.co/storage/v1/object/sign/writing-assets/a.png?token=x"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())
const createAdminClientMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}))

function adminClient({
  visibility = "public",
  deletedAt = null as string | null,
}: { visibility?: "private" | "shared" | "public"; deletedAt?: string | null } = {}) {
  const writingsLookups: unknown[] = []
  const rows: Record<string, unknown> = {
    writing_assets: { writing_id: writingId, storage_path: "a.png", author_id: authorId },
    writings: { author_id: authorId, visibility, deleted_at: deletedAt },
  }
  return {
    writingsLookups,
    client: {
      from: (table: string) => {
        if (table === "writings") writingsLookups.push(table)
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: rows[table], error: null }),
              maybeSingle: async () => ({ data: null, error: null }),
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }
      },
      storage: {
        from: () => ({ createSignedUrl: async () => ({ data: { signedUrl }, error: null }) }),
      },
    },
  }
}

function request() {
  return new Request(`https://odessay.vercel.app/api/writing-assets/${assetId}`)
}

const params = Promise.resolve({ assetId })

describe("archived writings deny asset access to non-owners (ODE-523)", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    createAdminClientMock.mockReset()
  })

  it("regression: an active public asset is available to an anonymous caller", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
    const { client } = adminClient({ visibility: "public", deletedAt: null })
    createAdminClientMock.mockReturnValue(client)

    const response = await GET(request(), { params })

    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe(signedUrl)
  })

  it("denies an anonymous caller once the same writing is archived", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
    const { client } = adminClient({ visibility: "public", deletedAt: "2026-09-01T00:00:00.000Z" })
    createAdminClientMock.mockReturnValue(client)

    const response = await GET(request(), { params })

    expect(response.status).toBe(403)
  })

  it("denies an unrelated authenticated caller once the same writing is archived", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: strangerId })
    const { client } = adminClient({ visibility: "public", deletedAt: "2026-09-01T00:00:00.000Z" })
    createAdminClientMock.mockReturnValue(client)

    const response = await GET(request(), { params })

    expect(response.status).toBe(403)
  })

  it("denies a shared recipient once the writing is archived, even though the share still exists", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: strangerId })
    const { client } = adminClient({ visibility: "shared", deletedAt: "2026-09-01T00:00:00.000Z" })
    createAdminClientMock.mockReturnValue(client)

    const response = await GET(request(), { params })

    expect(response.status).toBe(403)
  })

  it("named test (requirement 3): the owner can still retrieve their own archived writing's asset", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: authorId })
    const { client } = adminClient({ visibility: "public", deletedAt: "2026-09-01T00:00:00.000Z" })
    createAdminClientMock.mockReturnValue(client)

    const response = await GET(request(), { params })

    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe(signedUrl)
  })

  it("restoring the writing (deleted_at cleared) returns anonymous access to normal", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
    const { client } = adminClient({ visibility: "public", deletedAt: null })
    createAdminClientMock.mockReturnValue(client)

    const response = await GET(request(), { params })

    expect(response.status).toBe(302)
  })

  it("sets a private, no-store cache policy on both the denial and the success", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })

    const denied = adminClient({ visibility: "public", deletedAt: "2026-09-01T00:00:00.000Z" })
    createAdminClientMock.mockReturnValue(denied.client)
    const deniedResponse = await GET(request(), { params })
    expect(deniedResponse.status).toBe(403)
    expect(deniedResponse.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")

    const allowed = adminClient({ visibility: "public", deletedAt: null })
    createAdminClientMock.mockReturnValue(allowed.client)
    const allowedResponse = await GET(request(), { params })
    expect(allowedResponse.status).toBe(302)
    expect(allowedResponse.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
  })

  it("resolves deleted_at from the same authorization lookup — no second query (Performance Architecture)", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })
    const { client, writingsLookups } = adminClient({ visibility: "public", deletedAt: null })
    createAdminClientMock.mockReturnValue(client)

    await GET(request(), { params })

    expect(writingsLookups).toHaveLength(1)
  })
})
