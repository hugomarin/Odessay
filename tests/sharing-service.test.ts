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
})
