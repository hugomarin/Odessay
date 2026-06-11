import { describe, expect, it } from "vitest"

describe("external web handoff links", () => {
  it("builds web writing action URLs from NEXT_PUBLIC_APP_URL", async () => {
    const { buildWebWritingActionUrl } = await import("@/lib/runtime/external-link")

    expect(
      buildWebWritingActionUrl({
        writingId: "writing 1",
        action: "publish",
        appUrl: "https://odessay.vercel.app/app",
      }),
    ).toBe("https://odessay.vercel.app/write/writing%201?desktop=1&action=publish")
  })

  it("returns null when the configured app URL is not http(s)", async () => {
    const { buildWebWritingActionUrl } = await import("@/lib/runtime/external-link")

    expect(
      buildWebWritingActionUrl({
        writingId: "writing-1",
        action: "share",
        appUrl: "tauri://localhost",
      }),
    ).toBeNull()
  })
})
