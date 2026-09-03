import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadDesktopSharedReading } from "@/lib/services/shared-reading-service"

const getUserMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const rpcMock = vi.hoisted(() => vi.fn())
const fromSelectMock = vi.hoisted(() => vi.fn())
const fromEqMock = vi.hoisted(() => vi.fn())
const fromIsMock = vi.hoisted(() => vi.fn())
const fromMaybeSingleMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: {
      getUser: getUserMock,
      getSession: getSessionMock,
    },
    rpc: rpcMock,
    from: () => ({
      select: fromSelectMock,
    }),
  }),
}))

describe("desktop shared reading asset resolution", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.test"
    getUserMock.mockReset()
    getSessionMock.mockReset()
    rpcMock.mockReset()
    fromSelectMock.mockReset()
    fromEqMock.mockReset()
    fromIsMock.mockReset()
    fromMaybeSingleMock.mockReset()
    vi.restoreAllMocks()
  })

  it("rewrites shared artifact asset URLs to signed web URLs before rendering", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } })
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "desktop-token" } } })
    rpcMock.mockResolvedValue({
      data: [
        {
          id: "writing-1",
          title: "Shared",
          slug: "shared",
          body_text: "Body",
          updated_at: "2026-07-02T00:00:00.000Z",
          author_username: "misterymotion",
          author_display_name: "misterymotion",
        },
      ],
      error: null,
    })

    fromMaybeSingleMock.mockResolvedValue({
      data: {
        id: "writing-1",
        title: "Shared",
        body_json: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "image",
                  attrs: { src: "/api/writing-assets/b1708c84-f670-4fcf-9374-c4c77d5f5c92", alt: "Alt" },
                },
              ],
            },
          ],
        },
        body_text: "Body",
        updated_at: "2026-07-02T00:00:00.000Z",
      },
      error: null,
    })
    fromIsMock.mockReturnValue({ maybeSingle: fromMaybeSingleMock })
    fromEqMock.mockReturnValue({ is: fromIsMock })
    fromSelectMock.mockReturnValue({ eq: fromEqMock })

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      url: "https://signed.example.com/asset.png",
    } as Response)

    const result = await loadDesktopSharedReading("writing-1")

    expect(result.error).toBeNull()
    expect(result.data?.writing.bodyJson).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "https://signed.example.com/asset.png", alt: "Alt" },
            },
          ],
        },
      ],
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://app.odessay.test/api/writing-assets/b1708c84-f670-4fcf-9374-c4c77d5f5c92",
      expect.objectContaining({
        headers: { authorization: "Bearer desktop-token" },
      }),
    )
  })
})
