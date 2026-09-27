/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SelectionPopup } from "@/components/reading/margins/selection-popup"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => null
const dismiss = vi.fn<() => void>(() => {})
const applyEntity = vi.fn<(type: unknown) => string | null>(() => null)
const applyHighlight = vi.fn<(color: string) => string | null>(() => null)

const position = { x: 120, y: 200, top: 180, bottom: 200, placement: "above" as const }

let container: HTMLDivElement
let root: Root

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

function renderSemantic() {
  return render(
    <SelectionPopup
      position={position}
      onDismiss={dismiss}
      onApplyEntity={applyEntity}
      onApplyHighlight={applyHighlight}
    />,
  )
}

function buttonByLabel(label: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === label || button.textContent?.trim() === label,
  )
  return match ?? null
}

async function pointerDown(element: Element | null) {
  if (!element) throw new Error("Element not found.")
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
  })
}

async function pressEscape(element: Element | null) {
  if (!element) throw new Error("Element not found.")
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    )
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  dismiss.mockClear()
  applyEntity.mockClear()
  applyEntity.mockImplementation(() => null)
  applyHighlight.mockClear()
  applyHighlight.mockImplementation(() => null)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("ODE-532 selection bubble semantic marks", () => {
  it("keeps the reading surface without the overflow trigger", async () => {
    await render(<SelectionPopup position={position} onDismiss={dismiss} />)
    expect(buttonByLabel("More mark options")).toBeNull()
    expect(container.querySelectorAll("button")).toHaveLength(3)
  })

  it("opens the overflow menu with Entity and Highlight through one owner", async () => {
    await renderSemantic()
    const more = buttonByLabel("More mark options")
    expect(more).not.toBeNull()
    await pointerDown(more)

    expect(buttonByLabel("Entity")).not.toBeNull()
    expect(buttonByLabel("Highlight")).not.toBeNull()
  })

  it("moves focus to the first entity type option and applies by keyboard reachability", async () => {
    await renderSemantic()
    await pointerDown(buttonByLabel("More mark options"))
    await pointerDown(buttonByLabel("Entity"))

    const focused = container.querySelector<HTMLElement>("[role='menu'] button")
    expect(focused?.textContent?.trim()).toBe("Person")

    await pointerDown(buttonByLabel("Organization"))
    expect(applyEntity).toHaveBeenCalledWith("organization")
    expect(dismiss).toHaveBeenCalled()
  })

  it("shows the invalid-selection message without dismissing the popup", async () => {
    applyEntity.mockImplementation(() => "This selection would cross an existing semantic mark.")
    await renderSemantic()
    await pointerDown(buttonByLabel("More mark options"))
    await pointerDown(buttonByLabel("Entity"))
    await pointerDown(buttonByLabel("Person"))

    const status = container.querySelector("[role='status']")
    expect(status?.textContent).toBe("This selection would cross an existing semantic mark.")
    expect(dismiss).not.toHaveBeenCalled()
  })

  it("returns one level per Escape and restores the trigger focus", async () => {
    await renderSemantic()
    await pointerDown(buttonByLabel("More mark options"))
    await pointerDown(buttonByLabel("Entity"))

    const view = container.querySelector("[data-popup-view]")
    await act(async () => {
      view?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      )
    })

    expect(buttonByLabel("Back")).not.toBeNull()
    expect(document.activeElement?.textContent?.trim()).toBe("Entity")

    await pressEscape(container.querySelector("[data-popup-view]"))
    expect(buttonByLabel("More mark options")).not.toBeNull()
    expect(document.activeElement?.getAttribute("aria-label")).toBe("More mark options")

    await pressEscape(document.activeElement)
    expect(dismiss).toHaveBeenCalled()
  })

  it("shows the highlight palette with accessible color labels", async () => {
    await renderSemantic()
    await pointerDown(buttonByLabel("More mark options"))
    await pointerDown(buttonByLabel("Highlight"))

    for (const label of ["Highlight Amber (default)", "Highlight Green", "Highlight Indigo", "Highlight Slate"]) {
      expect(buttonByLabel(label)).not.toBeNull()
    }

    await pointerDown(buttonByLabel("Highlight Green"))
    expect(applyHighlight).toHaveBeenCalledWith("green")
    expect(dismiss).toHaveBeenCalled()
  })

  it("keeps highlight palette available without color rewriting", async () => {
    applyHighlight.mockImplementation(() => null)
    await renderSemantic()
    await pointerDown(buttonByLabel("More mark options"))
    await pointerDown(buttonByLabel("Highlight"))
    await pointerDown(buttonByLabel("Highlight Slate"))

    expect(applyHighlight).toHaveBeenCalledWith("slate")
  })
})
