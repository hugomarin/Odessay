import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/writings/import/route"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())
const getPreviewWritingFromTestLinkMock = vi.hoisted(() => vi.fn())
const supabaseFromMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/sharing/test-link-access", () => ({
  getPreviewWritingFromTestLink: getPreviewWritingFromTestLinkMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: supabaseFromMock,
  })),
}))

describe("POST /api/writings/import", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    getPreviewWritingFromTestLinkMock.mockReset()
    supabaseFromMock.mockReset()
  })

  it("returns 401 when there is no active session", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })

    const response = await POST(
      new Request("http://localhost/api/writings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "preview", token: "fixturepreviewoktoken0001" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "No active session.",
      },
    })
  })

  it("revalidates preview tokens and returns only the new id", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })
    getPreviewWritingFromTestLinkMock.mockResolvedValue({
      state: "ok",
      writing: {
        id: "source-writing",
        title: "Shared draft",
        bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
        bodyText: "Hello",
      },
    })

    const insertSingleMock = vi.fn().mockResolvedValue({ data: { id: "copy-1" }, error: null })
    const insertSelectMock = vi.fn(() => ({ single: insertSingleMock }))
    const insertMock = vi.fn(() => ({ select: insertSelectMock }))

    supabaseFromMock.mockImplementation((table: string) => {
      expect(table).toBe("writings")
      return {
        insert: insertMock,
      }
    })

    const response = await POST(
      new Request("http://localhost/api/writings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "preview", token: "fixturepreviewoktoken0001" }),
      }),
    )
    const body = await response.json()

    expect(getPreviewWritingFromTestLinkMock).toHaveBeenCalledWith("fixturepreviewoktoken0001")
    expect(response.status).toBe(201)
    expect(body).toEqual({ id: "copy-1" })
    expect(body).not.toHaveProperty("body_json")

    const insertedRow = ((insertMock.mock.calls[0] as unknown) as [Record<string, unknown>] | undefined)?.[0]
    expect(insertedRow).toMatchObject({
      author_id: "user-1",
      title: "Copy of Shared draft",
      body_text: "Hello",
      status: "draft",
      visibility: "private",
      parent_id: null,
      correspondence_id: null,
      version: 1,
    })
  })

  it("returns 403 when the caller is not allowed to copy a shared writing", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })

    const shareMaybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const shareEqSharedWithMock = vi.fn(() => ({ maybeSingle: shareMaybeSingleMock }))
    const shareEqWritingMock = vi.fn(() => ({ eq: shareEqSharedWithMock }))
    const shareSelectMock = vi.fn(() => ({ eq: shareEqWritingMock }))

    const writingMaybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "writing-1",
        author_id: "owner-1",
        title: "Shared writing",
        body_json: { type: "doc", content: [] },
        body_text: "Body",
      },
      error: null,
    })
    const writingDeletedMock = vi.fn(() => ({ maybeSingle: writingMaybeSingleMock }))
    const writingEqIdMock = vi.fn(() => ({ is: writingDeletedMock }))
    const writingSelectMock = vi.fn(() => ({ eq: writingEqIdMock }))

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "writings") {
        return { select: writingSelectMock }
      }

      if (table === "writing_shares") {
        return { select: shareSelectMock }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new Request("http://localhost/api/writings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "shared", writingId: "11111111-1111-4111-8111-111111111111" }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have access to this shared writing.",
      },
    })
  })
})
