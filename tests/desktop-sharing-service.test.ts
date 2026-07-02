import { beforeEach, describe, expect, it, vi } from "vitest"
import { createDesktopSharingService } from "@/lib/services/desktop/desktop-sharing-service"

const getSessionMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: {
      getSession: getSessionMock,
      getUser: vi.fn(),
    },
  }),
}))

describe("desktop sharing service preview-link bridge", () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.unstubAllGlobals()
  })

  it("returns a readable error when NEXT_PUBLIC_APP_URL is missing", async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "desktop-token" } },
      error: null,
    })

    const service = createDesktopSharingService()
    const result = await service.getPreviewLink("writing-1")

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      code: "UNAVAILABLE",
      message: "Preview links are unavailable because NEXT_PUBLIC_APP_URL is not configured.",
      retryable: false,
    })
  })

  it("returns UNAUTHORIZED when there is no active desktop session", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com"
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    })

    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const service = createDesktopSharingService()
    const result = await service.rotatePreviewLink("writing-1")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      code: "UNAUTHORIZED",
      message: "No active session.",
      retryable: false,
    })
  })

  it("loads preview links through the absolute authenticated web bridge", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com/"
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "desktop-token" } },
      error: null,
    })

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            active: true,
            token: "preview-token",
            link: "https://app.odessay.com/preview/preview-token",
            createdAt: "2026-07-02T00:00:00.000Z",
          },
          error: null,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const service = createDesktopSharingService()
    const result = await service.getPreviewLink("writing-1")

    expect(fetchMock).toHaveBeenCalledWith("https://app.odessay.com/api/writings/writing-1/share-test-link", {
      method: "GET",
      cache: "no-store",
      headers: {
        authorization: "Bearer desktop-token",
      },
    })
    expect(result.data).toEqual({
      active: true,
      token: "preview-token",
      link: "https://app.odessay.com/preview/preview-token",
      createdAt: "2026-07-02T00:00:00.000Z",
    })
  })

  it("surfaces a readable fallback when the desktop bridge fetch fails", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com"
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "desktop-token" } },
      error: null,
    })

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down")
    }))

    const service = createDesktopSharingService()
    const result = await service.rotatePreviewLink("writing-1")

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      code: "UNAVAILABLE",
      message: "Could not generate the preview link right now.",
      retryable: false,
    })
  })

  it("revokes preview links through the same desktop bridge", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com"
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "desktop-token" } },
      error: null,
    })

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            writingId: "writing-1",
            revoked: true,
          },
          error: null,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const service = createDesktopSharingService()
    const result = await service.revokePreviewLink("writing-1")

    expect(fetchMock).toHaveBeenCalledWith("https://app.odessay.com/api/writings/writing-1/share-test-link", {
      method: "DELETE",
      headers: {
        authorization: "Bearer desktop-token",
      },
    })
    expect(result.data).toEqual({
      writingId: "writing-1",
      revoked: true,
    })
  })
})
