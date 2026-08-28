/** @vitest-environment happy-dom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UpdateNotice } from "@/components/navigation/update-notice"

/**
 * The update pipeline shipped without this surface: `checkForUpdate` ran on
 * mount, stored an available release, and nothing rendered it, so a published
 * version could not reach anyone who was not watching GitHub.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("UpdateNotice", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (props: Partial<Parameters<typeof UpdateNotice>[0]> = {}) =>
    act(() => {
      root.render(
        // The rail wraps its whole tree in a provider; the collapsed glyph's
        // tooltip needs it.
        <TooltipProvider>
        <UpdateNotice
          label="Artifact Studio 0.8.0 is available"
          collapsed={false}
          installing={false}
          error={null}
          onInstall={vi.fn()}
          onDismiss={vi.fn()}
          {...props}
        />
        </TooltipProvider>,
      )
    })

  it("names the version and says what installing costs", () => {
    render()

    expect(container.textContent).toContain("Artifact Studio 0.8.0 is available")
    // Installing relaunches the app; hiding that turns a click into a surprise.
    expect(container.textContent).toContain("restarts Artifact Studio")
  })

  it("asks before downloading anything", () => {
    const onInstall = vi.fn()
    render({ onInstall })

    // The checker's contract: no bytes move without an explicit press.
    expect(onInstall).not.toHaveBeenCalled()
    const install = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Install"),
    )
    act(() => install?.click())
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("locks both actions while installing and explains the wait", () => {
    render({ installing: true })

    for (const button of container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true)
    }
    expect(container.textContent).toContain("Downloading")
  })

  it("surfaces a failed install instead of leaving it in the console", () => {
    render({ error: "Signature check failed." })

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe("Signature check failed.")
  })

  it("collapses to a single glyph that still carries the version", () => {
    render({ collapsed: true })

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="update-notice-collapsed"]',
    )
    // The 52px rail has no room for a card, but the release must stay reachable.
    expect(button).not.toBeNull()
    expect(button?.getAttribute("aria-label")).toBe("Artifact Studio 0.8.0 is available")
    expect(container.querySelector('[data-testid="update-notice"]')).toBeNull()
  })
})
