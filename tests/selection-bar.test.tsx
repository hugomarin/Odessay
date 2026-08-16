/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SELECTION_BAR_SHEET_ATTR,
  SELECTION_BAR_SHEET_PADDING,
  SelectionBar,
  type SelectionBarAction,
} from "@/components/shared/selection-bar"

/**
 * ODE-428 — the shared selection bar.
 *
 * Geometry is asserted against the values both prototypes render
 * (`Artifact Studio Desk.dc.html`, `Artifact Studio Settings.dc.html`), not
 * against the prose, which is a reading of them.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function render(node: React.ReactNode) {
  act(() => root.render(node))
}

function bar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="selection-bar"]')
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  })
}

const noop = () => {}

describe("visibility by selection count", () => {
  it("renders nothing while no row is selected", () => {
    render(<SelectionBar selectedCount={0} onDeselectAll={noop} actions={[]} />)
    expect(bar()).toBeNull()
  })

  it("appears at one selected row and disappears when the count returns to zero", () => {
    render(<SelectionBar selectedCount={1} onDeselectAll={noop} actions={[]} />)
    expect(bar()).not.toBeNull()

    // Failure mode 1: another source (watcher, sync) drops the selected rows.
    // The bar leaves rather than claiming a count it no longer has.
    render(<SelectionBar selectedCount={0} onDeselectAll={noop} actions={[]} />)
    expect(bar()).toBeNull()
  })

  it("labels the count as the prototypes render it", () => {
    render(<SelectionBar selectedCount={3} onDeselectAll={noop} actions={[]} />)
    expect(bar()?.textContent).toContain("3 selected")
  })
})

describe("geometry — the prototype is the authority", () => {
  beforeEach(() => {
    render(<SelectionBar selectedCount={2} onDeselectAll={noop} actions={[]} />)
  })

  it.each([
    ["height 56px", "h-14"],
    ["radius 14", "rounded-bar"],
    ["ink background", "bg-ink"],
    ["26px off the bottom edge", "bottom-[26px]"],
    ["centred", "left-1/2"],
    ["centred by translation", "-translate-x-1/2"],
    ["the two-layer prototype shadow", "shadow-selection-bar"],
    ["22px of leading padding", "pl-[22px]"],
    ["14px of trailing padding", "pr-3.5"],
    ["10px gaps", "gap-2.5"],
  ])("keeps %s", (_label, className) => {
    expect(bar()?.className).toContain(className)
  })

  it("is pinned to the viewport by default and to the sheet on request", () => {
    expect(bar()?.className).toContain("fixed")

    render(
      <SelectionBar selectedCount={2} onDeselectAll={noop} actions={[]} placement="absolute" />,
    )
    expect(bar()?.className).toContain("absolute")
    expect(bar()?.className).not.toContain("fixed")
  })
})

describe("the destructive chip", () => {
  it("carries the terracotta tint both prototypes render, not a red", () => {
    const actions: SelectionBarAction[] = [
      { id: "delete", label: "Delete", destructive: true, onSelect: noop },
    ]
    render(<SelectionBar selectedCount={1} onDeselectAll={noop} actions={actions} />)

    const chip = document.querySelector('[data-testid="selection-bar-action-delete"]')
    expect(chip?.className).toContain("bg-cursor/30")
    expect(chip?.className).toContain("hover:bg-cursor/[.42]")
    expect(chip?.className).toContain("text-danger-chip-fg")
  })
})

describe("the sheet stays reachable", () => {
  /**
   * Mirrors the real arrangement: the scrolling sheet and the bar are siblings
   * inside the positioned wrapper, because the bar has to paint over the rows.
   * An earlier version of the hook only looked at ancestors and silently found
   * nothing here — which is exactly the layout every consumer uses.
   */
  function renderInsideSheet(selectedCount: number) {
    const wrapper = document.createElement("div")
    const sheet = document.createElement("div")
    sheet.setAttribute(SELECTION_BAR_SHEET_ATTR, "")
    sheet.style.paddingBottom = "8px"
    wrapper.append(sheet, container)
    document.body.appendChild(wrapper)
    render(<SelectionBar selectedCount={selectedCount} onDeselectAll={noop} actions={[]} />)
    return sheet
  }

  it("pads the sheet by 96px while the bar is up, then restores it", () => {
    const sheet = renderInsideSheet(2)
    expect(sheet.style.paddingBottom).toBe(`${SELECTION_BAR_SHEET_PADDING}px`)

    render(<SelectionBar selectedCount={0} onDeselectAll={noop} actions={[]} />)
    expect(sheet.style.paddingBottom).toBe("8px")
  })

  it("uses 96px, the value the spec calls the most-forgotten requirement", () => {
    expect(SELECTION_BAR_SHEET_PADDING).toBe(96)
  })
})

describe("keyboard", () => {
  it("deselects on Escape", () => {
    const onDeselectAll = vi.fn()
    render(<SelectionBar selectedCount={2} onDeselectAll={onDeselectAll} actions={[]} />)

    pressEscape()
    expect(onDeselectAll).toHaveBeenCalledTimes(1)
  })

  it("does not listen for Escape once the selection is empty", () => {
    const onDeselectAll = vi.fn()
    render(<SelectionBar selectedCount={0} onDeselectAll={onDeselectAll} actions={[]} />)

    pressEscape()
    expect(onDeselectAll).not.toHaveBeenCalled()
  })

  it("exposes every action as a focusable button, so none of them is mouse-only", () => {
    const actions: SelectionBarAction[] = [
      { id: "archive", label: "Archive", onSelect: noop },
      { id: "delete", label: "Delete", destructive: true, onSelect: noop },
    ]
    render(
      <SelectionBar
        selectedCount={2}
        onSelectAll={noop}
        onDeselectAll={noop}
        actions={actions}
      />,
    )

    const buttons = Array.from(bar()?.querySelectorAll("button") ?? [])
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Select all",
      "Deselect",
      "Archive",
      "Delete",
    ])
    // No positive tabindex and no aria-hidden: natural tab order reaches them all.
    expect(buttons.every((button) => !button.hasAttribute("tabindex"))).toBe(true)
  })

  it("announces itself as a toolbar", () => {
    render(<SelectionBar selectedCount={1} onDeselectAll={noop} actions={[]} />)
    expect(bar()?.getAttribute("role")).toBe("toolbar")
    expect(bar()?.getAttribute("aria-label")).toBe("Selection actions")
  })
})

describe("actions in flight", () => {
  it("shows a busy state with a guaranteed exit on success", async () => {
    let release!: () => void
    const onSelect = vi.fn(
      () =>
        new Promise<void>((resolvePromise) => {
          release = resolvePromise
        }),
    )
    render(
      <SelectionBar
        selectedCount={4}
        onDeselectAll={noop}
        actions={[{ id: "archive", label: "Archive", onSelect }]}
      />,
    )

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-testid="selection-bar-action-archive"]',
    )!
    await act(async () => {
      chip.click()
    })

    expect(bar()?.getAttribute("aria-busy")).toBe("true")
    expect(chip.disabled).toBe(true)

    await act(async () => {
      release()
    })

    expect(bar()?.getAttribute("aria-busy")).toBeNull()
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="selection-bar-action-archive"]')!
        .disabled,
    ).toBe(false)
  })

  it("leaves the busy state when the action rejects, instead of staying disabled forever", async () => {
    const onSelect = vi.fn(() => Promise.reject(new Error("bulk archive failed")))
    render(
      <SelectionBar
        selectedCount={4}
        onDeselectAll={noop}
        actions={[{ id: "archive", label: "Archive", onSelect }]}
      />,
    )

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-testid="selection-bar-action-archive"]',
    )!
    await act(async () => {
      // The rejection belongs to the caller; the bar only guarantees it recovers.
      chip.click()
      await Promise.resolve().catch(() => {})
    })
    await act(async () => {})

    expect(bar()?.getAttribute("aria-busy")).toBeNull()
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="selection-bar-action-archive"]')!
        .disabled,
    ).toBe(false)
  })
})

describe("reactive fan-out", () => {
  it("emits one logical update for a bulk action over 20 rows, not one per row", async () => {
    const onSelect = vi.fn()
    render(
      <SelectionBar
        selectedCount={20}
        onDeselectAll={noop}
        actions={[{ id: "archive", label: "Archive", onSelect }]}
      />,
    )

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="selection-bar-action-archive"]')!
        .click()
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe("the bar knows nothing about any domain", () => {
  const source = readFileSync(
    resolve(__dirname, "../components/shared/selection-bar.tsx"),
    "utf8",
  )

  it.each(["@/components/desk/", "@/components/settings/", "@/lib/writings/", "@/lib/collections/"])(
    "does not import from %s",
    (forbidden) => {
      expect(source).not.toContain(forbidden)
    },
  )
})
