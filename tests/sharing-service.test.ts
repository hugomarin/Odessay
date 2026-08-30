import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createBrowserSharingService, normalizeShareRecipient } from "@/lib/services/web-sharing-service"

describe("web sharing service", () => {
  it("keeps node-only test-link helpers out of the browser bundle entrypoint", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/services/web-sharing-service.ts"), "utf8")

    expect(source).not.toContain('from "@/lib/sharing/test-link"')
    expect(source).not.toContain('await import("@/lib/sharing/test-link")')
    expect(source).toContain('crypto.randomUUID()')
  })

  it("normalizes route-level share rows into SharingService recipients", () => {
    expect(
      normalizeShareRecipient({
        shared_with_id: "user-1",
        can_respond: true,
        created_at: "2026-05-26T00:00:00.000Z",
        profiles: { username: "hugo", display_name: "Hugo Marín" },
      }),
    ).toEqual({
      userId: "user-1",
      username: "hugo",
      displayName: "Hugo Marín",
      canRespond: true,
      sharedAt: "2026-05-26T00:00:00.000Z",
    })
  })

  it("loads recipient previews through the batch shares endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            "writing-1": [{ username: "hugo", displayName: "Hugo Marín" }],
          },
          error: null,
        }),
        { status: 200 },
      ),
    )

    const sharingService = createBrowserSharingService(fetchMock as typeof fetch)
    const result = await sharingService.listRecipientPreviews(["writing-1"])

    expect(fetchMock).toHaveBeenCalledWith("/api/writings/shares?ids=writing-1", { cache: "no-store" })
    expect(result).toEqual({
      data: {
        "writing-1": [{ username: "hugo", displayName: "Hugo Marín" }],
      },
      error: null,
    })
  })

  it("surfaces preview link errors through the sharing service envelope", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "NOT_FOUND",
            message: "Writing not found.",
          },
        }),
        { status: 404 },
      ),
    )

    const sharingService = createBrowserSharingService(fetchMock as typeof fetch)
    const result = await sharingService.getPreviewLink("writing-404")

    expect(result.data).toBeNull()
    expect(result.error).toEqual({
      code: "NOT_FOUND",
      message: "Writing not found.",
      retryable: false,
    })
  })

  it("rotates preview links through the browser sharing boundary", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            active: true,
            token: "preview-token",
            link: "https://app.odessay.com/preview/preview-token",
            createdAt: "2026-05-27T00:00:00.000Z",
          },
          error: null,
        }),
        { status: 200 },
      ),
    )

    const sharingService = createBrowserSharingService(fetchMock as typeof fetch)
    const result = await sharingService.rotatePreviewLink("writing-1")

    expect(fetchMock).toHaveBeenCalledWith("/api/writings/writing-1/share-test-link", { method: "POST" })
    expect(result.data).toEqual({
      active: true,
      token: "preview-token",
      link: "https://app.odessay.com/preview/preview-token",
      createdAt: "2026-05-27T00:00:00.000Z",
    })
  })

  it("revokes preview links through the browser sharing boundary", async () => {
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

    const sharingService = createBrowserSharingService(fetchMock as typeof fetch)
    const result = await sharingService.revokePreviewLink("writing-1")

    expect(fetchMock).toHaveBeenCalledWith("/api/writings/writing-1/share-test-link", { method: "DELETE" })
    expect(result.data).toEqual({
      writingId: "writing-1",
      revoked: true,
    })
  })

  it("loads incoming shared artifacts through the stable shared list payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "writing-1",
              title: "Shared writing",
              slug: "shared-writing",
              excerpt: "Body excerpt",
              updatedAt: "2026-05-27T00:00:00.000Z",
              author: {
                username: "hugo",
                displayName: "Hugo Marín",
              },
            },
          ],
          error: null,
        }),
        { status: 200 },
      ),
    )

    const sharingService = createBrowserSharingService(fetchMock as typeof fetch)
    const result = await sharingService.listIncomingShares()

    expect(fetchMock).toHaveBeenCalledWith("/api/shared/writings", { cache: "no-store" })
    expect(result.data).toEqual([
      {
        id: "writing-1",
        title: "Shared writing",
        slug: "shared-writing",
        excerpt: "Body excerpt",
        updatedAt: "2026-05-27T00:00:00.000Z",
        author: {
          username: "hugo",
          displayName: "Hugo Marín",
        },
      },
    ])
  })
})
