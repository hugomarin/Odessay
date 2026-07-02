/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const redirectMock = vi.fn()

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/components/reading/desktop-shared-entry", () => ({
  DesktopSharedEntry: () => ({ type: "desktop-shared-entry" }),
}))

describe("SharedPage runtime split", () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.TAURI_BUILD
    delete process.env.TAURI_ENV
    redirectMock.mockReset()
  })

  it("redirects web runtime back to Desk shared tab", async () => {
    const SharedPage = (await import("@/app/(app)/shared/page")).default
    SharedPage()

    expect(redirectMock).toHaveBeenCalledWith("/desk?tab=shared")
  })

  it("renders the desktop shared entry in tauri runtime", async () => {
    process.env.TAURI_BUILD = "true"
    const SharedPage = (await import("@/app/(app)/shared/page")).default
    const element = SharedPage() as unknown as { type?: unknown }

    expect(redirectMock).not.toHaveBeenCalled()
    expect(element.type).toBeDefined()
  })
})
