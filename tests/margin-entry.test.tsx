/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MarginEntry, type MarginData } from "@/components/reading/margins/margin-entry"

const baseMargin = (overrides: Partial<MarginData> = {}): MarginData => ({
  id: "margin-1",
  anchor_start: 0,
  anchor_end: 12,
  anchor_text: "Quoted passage",
  type: "personal",
  text: "Short note",
  note: "Short note",
  shared: false,
  shared_at: null,
  created_at: "2026-05-24T00:00:00.000Z",
  ...overrides,
})

const longNote =
  "This voice transcription should occupy more than three lines so the card needs an explicit expansion control instead of hiding the rest of the note."

let container: HTMLDivElement
let root: Root | null = null
let originalScrollHeight: PropertyDescriptor | undefined
let computedStyleSpy: ReturnType<typeof vi.spyOn> | null = null

function renderEntry(margin: MarginData) {
  root = createRoot(container)

  act(() => {
    root?.render(
      <MarginEntry
        margin={margin}
        focused={false}
        onFocus={vi.fn()}
        onBlur={vi.fn()}
        onUpdateNote={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)

  originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight")
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.value.length > 80 ? 88 : 40
    },
  })

  computedStyleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const styles = element instanceof HTMLElement ? element.style : ({} as CSSStyleDeclaration)
    return {
      ...styles,
      lineHeight: "20px",
    } as CSSStyleDeclaration
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container.remove()

  if (originalScrollHeight) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight)
  }

  computedStyleSpy?.mockRestore()
  computedStyleSpy = null
})

describe("MarginEntry", () => {
  it("shows a collapsed 3-line preview for long annotations and toggles expansion", () => {
    renderEntry(baseMargin({ text: longNote, note: longNote }))

    const textarea = container.querySelector("textarea")
    const toggle = container.querySelector("button[aria-expanded='false']")

    expect(textarea).not.toBeNull()
    expect(toggle?.textContent).toBe("Show more")
    expect(textarea?.style.height).toBe("60px")

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const expandedToggle = container.querySelector("button[aria-expanded='true']")
    expect(expandedToggle?.textContent).toBe("Show less")
    expect(textarea?.style.height).toBe("88px")
  })

  it("does not render an expand control for short annotations", () => {
    renderEntry(baseMargin({ text: "Brief note", note: "Brief note" }))

    const textarea = container.querySelector("textarea")
    const toggle = container.querySelector("button[aria-expanded]")

    expect(toggle).toBeNull()
    expect(textarea?.style.height).toBe("40px")
  })
})
