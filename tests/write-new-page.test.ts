/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest"

describe("NewWritePage redirect", () => {
  it("redirects to /write?new=1", async () => {
    const redirect = vi.fn()
    vi.doMock("next/navigation", () => ({ redirect }))

    const { default: NewWritePage } = await import("@/app/(app)/write/new/page")
    NewWritePage()
    expect(redirect).toHaveBeenCalledWith("/write?new=1")

    vi.doUnmock("next/navigation")
  })
})
