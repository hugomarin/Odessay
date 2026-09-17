/**
 * @vitest-environment happy-dom
 */
import { act, useInsertionEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DesktopWriteEntry } from "@/components/editor/desktop-write-entry"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/editor/editor-shell", () => ({
  EditorShell: ({ writingId, forceNewWriting }: { writingId?: string; forceNewWriting?: boolean }) => (
    <div
      data-testid="editor-shell"
      data-writing-id={writingId ?? ""}
      data-force-new-writing={forceNewWriting ? "true" : "false"}
    />
  ),
}))

function PushStateDuringInsertion({ href }: { href: string }) {
  useInsertionEffect(() => {
    window.history.pushState(null, "", href)
  }, [href])

  return null
}

describe("DesktopWriteEntry navigation bridge", () => {
  let container: HTMLDivElement
  let root: Root
  let originalPushState: History["pushState"]

  beforeEach(() => {
    originalPushState = window.history.pushState
    window.history.replaceState(null, "", "/write")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    window.history.pushState = originalPushState
    vi.restoreAllMocks()
    container.remove()
  })

  it("defers pushState notifications until React has finished its insertion phase", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await act(async () => {
      root.render(<DesktopWriteEntry />)
    })

    await act(async () => {
      root.render(
        <>
          <DesktopWriteEntry />
          <PushStateDuringInsertion href="/write?id=document-2" />
        </>,
      )
      await Promise.resolve()
    })

    expect(window.location.search).toBe("?id=document-2")
    expect(container.querySelector('[data-testid="editor-shell"]')?.getAttribute("data-writing-id"))
      .toBe("document-2")
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
      "useInsertionEffect must not schedule updates",
    )
  })
})
