/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EditorTabs } from "@/components/editor/editor-tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createEditorSessionTab } from "@/lib/local-db/editor-sessions"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const tabs = [
  createEditorSessionTab({ id: "writing-1", writingId: "writing-1", title: "First writing" }),
  createEditorSessionTab({ id: "writing-2", writingId: "writing-2", title: "Second writing" }),
]

const renderTabs = (overrides: Partial<React.ComponentProps<typeof EditorTabs>> = {}) => {
  const props: React.ComponentProps<typeof EditorTabs> = {
    tabs,
    activeTabId: "writing-1",
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onRenameTab: vi.fn(),
    onReorderTab: vi.fn(),
    onNewTab: vi.fn(),
    ...overrides,
  }

  act(() =>
    root.render(
      <TooltipProvider>
        <EditorTabs {...props} />
      </TooltipProvider>,
    ),
  )
  return props
}

const pointer = (type: string, values: Partial<PointerEventInit> = {}) =>
  new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: 10, clientY: 10, ...values })

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => []),
  })
})

afterEach(() => {
  act(() => root.unmount())
  document.querySelectorAll("[data-editor-tab-ghost]").forEach((ghost) => ghost.remove())
  document.documentElement.classList.remove("od-editor-tab-dragging")
  container.remove()
  vi.restoreAllMocks()
})

describe("EditorTabs pointer gestures", () => {
  it("selects a tab on pointerup when the gesture did not become a drag", () => {
    const props = renderTabs()
    const tab = container.querySelector<HTMLElement>('[data-editor-tab-id="writing-1"]')!

    act(() => {
      tab.dispatchEvent(pointer("pointerdown"))
      tab.dispatchEvent(pointer("pointerup"))
    })

    expect(props.onSelectTab).toHaveBeenCalledWith("writing-1")
    expect(props.onReorderTab).not.toHaveBeenCalled()
  })

  it("does not start a tab drag or show the webview menu on secondary click", () => {
    const props = renderTabs()
    const tab = container.querySelector<HTMLElement>('[data-editor-tab-id="writing-1"]')!
    const setPointerCapture = vi.mocked(tab.setPointerCapture)
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })

    act(() => {
      tab.dispatchEvent(pointer("pointerdown", { button: 2 }))
      tab.dispatchEvent(pointer("pointermove", { button: 2, clientX: 30, clientY: 10 }))
      tab.dispatchEvent(pointer("pointerup", { button: 2, clientX: 30, clientY: 10 }))
    })

    expect(tab.dispatchEvent(contextMenu)).toBe(false)
    expect(setPointerCapture).not.toHaveBeenCalled()
    expect(props.onSelectTab).not.toHaveBeenCalled()
    expect(props.onReorderTab).not.toHaveBeenCalled()
    expect(document.querySelector("[data-editor-tab-ghost]")).toBeNull()
    expect(document.documentElement.classList.contains("od-editor-tab-dragging")).toBe(false)
  })

  it("clears native selection and disposes an interrupted drag ghost", () => {
    const selection = window.getSelection()
    const removeAllRanges = vi.spyOn(selection!, "removeAllRanges")
    renderTabs()
    const elementsFromPoint = vi.mocked(document.elementsFromPoint)
    elementsFromPoint.mockReturnValue([
      container.querySelector<HTMLElement>('[data-editor-tab-id="writing-2"]')!,
    ])

    const tab = container.querySelector<HTMLElement>('[data-editor-tab-id="writing-1"]')!
    act(() => {
      tab.dispatchEvent(pointer("pointerdown"))
      tab.dispatchEvent(pointer("pointermove", { clientX: 30, clientY: 10 }))
    })

    expect(removeAllRanges).toHaveBeenCalled()
    expect(document.documentElement.classList.contains("od-editor-tab-dragging")).toBe(true)
    expect(document.querySelector("[data-editor-tab-ghost]")).not.toBeNull()
    expect(elementsFromPoint).toHaveBeenCalled()

    act(() => window.dispatchEvent(new Event("blur")))

    expect(document.documentElement.classList.contains("od-editor-tab-dragging")).toBe(false)
    expect(document.querySelector("[data-editor-tab-ghost]")).toBeNull()
  })

  it("removes an orphaned ghost before a fresh strip mounts", () => {
    const ghost = document.createElement("div")
    ghost.setAttribute("data-editor-tab-ghost", "true")
    document.body.appendChild(ghost)

    renderTabs()

    expect(document.querySelector("[data-editor-tab-ghost]")).toBeNull()
  })
})
