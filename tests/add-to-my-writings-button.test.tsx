/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AddToMyWritingsButton } from "@/components/reading/add-to-my-writings-button"

const pushMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

let container: HTMLDivElement
let root: Root | null = null

describe("AddToMyWritingsButton", () => {
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    pushMock.mockReset()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    container.remove()
  })

  it("redirects to login instead of posting when login is required", () => {
    root = createRoot(container)

    act(() => {
      root?.render(
        <AddToMyWritingsButton
          source="preview"
          token="fixturepreviewoktoken0001"
          loginHref="/login?next=%2Fpreview%2Ffixturepreviewoktoken0001%3Fimport%3D1"
        />,
      )
    })

    const button = container.querySelector('[data-testid="add-to-my-writings-btn"]')
    expect(button).not.toBeNull()

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(pushMock).toHaveBeenCalledWith("/login?next=%2Fpreview%2Ffixturepreviewoktoken0001%3Fimport%3D1")
  })

  it("auto-starts the import flow and navigates to the new writing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "copy-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    )
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <AddToMyWritingsButton
          source="preview"
          token="fixturepreviewoktoken0001"
          autoStart
        />,
      )
    })

    expect(fetch).toHaveBeenCalledWith(
      "/api/writings/import",
      expect.objectContaining({
        method: "POST",
      }),
    )
    expect(pushMock).toHaveBeenCalledWith("/write/copy-1")
  })

  it("renders a readable error when the import fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "PREVIEW_REVOKED" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    )
    root = createRoot(container)

    act(() => {
      root?.render(
        <AddToMyWritingsButton source="preview" token="fixturepreviewoktoken0001" />,
      )
    })

    const button = container.querySelector('[data-testid="add-to-my-writings-btn"]')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="add-to-my-writings-error"]')?.textContent).toContain(
      "This preview link is no longer available.",
    )
  })
})
