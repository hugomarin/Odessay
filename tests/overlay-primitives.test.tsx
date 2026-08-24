/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FormModal } from "@/components/ui/dialog"
import { DisplayModal } from "@/components/ui/display-modal"
import { FlowModal, FlowModalBody, FlowModalFooter, FlowModalHeader } from "@/components/ui/flow-modal"
import { FullOverlay } from "@/components/ui/full-overlay"
import { __resetOverlayRegistry } from "@/components/ui/overlay-core"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  __resetOverlayRegistry()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  // happy-dom keeps `activeElement` pointing at detached nodes between tests.
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function render(node: React.ReactNode) {
  act(() => root.render(node))
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  })
}

async function pointerDownOutside() {
  // Radix binds its outside-pointer listener on a later tick than the render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const outside = document.createElement("button")
  document.body.appendChild(outside)
  await act(async () => {
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    outside.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  outside.remove()
}

function surface(testId: string) {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
}

describe("overlay primitives — the closed inventory", () => {
  it("exposes the accessible modal markup on every modal pattern", () => {
    render(
      <FormModal open onOpenChange={() => {}} title="Rename artifact">
        <p>body</p>
      </FormModal>
    )

    const dialog = surface("form-modal")
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute("role")).toBe("dialog")
    expect(dialog?.getAttribute("aria-modal")).toBe("true")
    expect(document.body.textContent).toContain("Rename artifact")
  })

  it("closes on Escape", () => {
    const onOpenChange = vi.fn()
    render(
      <FormModal open onOpenChange={onOpenChange} title="Rename artifact">
        <p>body</p>
      </FormModal>
    )

    pressEscape()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("closes on a scrim click when no field is dirty", async () => {
    const onOpenChange = vi.fn()
    render(
      <FormModal open onOpenChange={onOpenChange} title="Rename artifact">
        <p>body</p>
      </FormModal>
    )

    await pointerDownOutside()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("confirms before discarding a dirty field, and keeps the state when cancelled", async () => {
    function DirtyForm() {
      const [open, setOpen] = useState(true)
      const [value, setValue] = useState("")
      return (
        <FormModal open={open} onOpenChange={setOpen} title="Rename artifact" dirty={value.length > 0}>
          <input aria-label="name" value={value} onChange={(event) => setValue(event.target.value)} />
        </FormModal>
      )
    }

    render(<DirtyForm />)

    const input = document.querySelector<HTMLInputElement>("input[aria-label='name']")
    expect(input).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "draft name")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await pointerDownOutside()

    // The overlay is still open, showing the confirmation instead of closing.
    expect(surface("overlay-discard-confirm")).not.toBeNull()
    expect(surface("form-modal")).not.toBeNull()

    const keepEditing = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Keep editing"
    )
    act(() => keepEditing?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(surface("overlay-discard-confirm")).toBeNull()
    expect(surface("form-modal")).not.toBeNull()
    expect(document.querySelector<HTMLInputElement>("input[aria-label='name']")?.value).toBe("draft name")
  })

  it("discards and closes when the confirmation is accepted", async () => {
    function DirtyForm() {
      const [open, setOpen] = useState(true)
      return (
        <FormModal open={open} onOpenChange={setOpen} title="Rename artifact" dirty>
          <input aria-label="name" defaultValue="draft" />
        </FormModal>
      )
    }

    render(<DirtyForm />)
    await pointerDownOutside()
    expect(surface("overlay-discard-confirm")).not.toBeNull()

    const discard = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Discard")
    act(() => discard?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(surface("form-modal")).toBeNull()
  })

  it("is loud in development when a modal opens from a modal", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <>
        <FormModal open onOpenChange={() => {}} title="First">
          <p>first</p>
        </FormModal>
        <DisplayModal open onOpenChange={() => {}} title="Second">
          <p>second</p>
        </DisplayModal>
      </>
    )

    expect(error.mock.calls.some(([message]) => String(message).includes("Only one overlay at a time"))).toBe(true)
  })

  it("releases the body scroll lock when the overlay unmounts", () => {
    render(
      <FullOverlay open onOpenChange={() => {}} title="Artifact preview">
        <p>preview</p>
      </FullOverlay>
    )
    expect(surface("full-overlay")).not.toBeNull()

    act(() => root.render(<div />))

    expect(document.body.style.overflow).not.toBe("hidden")
    expect(document.querySelector("[data-testid='full-overlay']")).toBeNull()
  })

  it("returns focus to the trigger when it survives the overlay", async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <main data-overlay-focus-anchor>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          <FormModal open={open} onOpenChange={setOpen} title="Rename artifact">
            <p>body</p>
          </FormModal>
        </main>
      )
    }

    render(<Harness />)
    const trigger = document.querySelector<HTMLElement>("[data-testid='trigger']")
    act(() => {
      trigger?.focus()
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    pressEscape()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.activeElement).toBe(trigger)
  })

  it("returns focus to a stable anchor when the trigger is gone", async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      const [triggerMounted, setTriggerMounted] = useState(true)
      return (
        <main data-overlay-focus-anchor>
          {triggerMounted && (
            <button
              type="button"
              onClick={() => {
                setOpen(true)
                setTriggerMounted(false)
              }}
            >
              open
            </button>
          )}
          <FormModal open={open} onOpenChange={setOpen} title="Rename artifact">
            <p>body</p>
          </FormModal>
        </main>
      )
    }

    render(<Harness />)
    const trigger = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "open")
    act(() => {
      trigger?.focus()
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    pressEscape()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.activeElement).toBe(document.querySelector("main[data-overlay-focus-anchor]"))
    expect(document.activeElement).not.toBe(document.body)
  })

  it("gives the flow modal a fixed header, a 150px scrolling middle and a fixed footer", () => {
    render(
      <FlowModal open onOpenChange={() => {}} title="Add workspace">
        <FlowModalHeader>header</FlowModalHeader>
        <FlowModalBody>body</FlowModalBody>
        <FlowModalFooter>footer</FlowModalFooter>
      </FlowModal>
    )

    expect(surface("flow-modal")?.className).toContain("w-[640px]")
    expect(surface("flow-modal")?.className).toContain("max-h-[calc(100vh-48px)]")
    expect(surface("flow-modal-header")?.className).toContain("flex-shrink-0")
    expect(surface("flow-modal-body")?.className).toContain("min-h-[150px]")
    expect(surface("flow-modal-footer")?.className).toContain("flex-shrink-0")
  })

  it("gives the full overlay its own 48px chrome row over inset-0", () => {
    render(
      <FullOverlay open onOpenChange={() => {}} title="Search">
        <p>results</p>
      </FullOverlay>
    )

    expect(surface("full-overlay")?.className).toContain("inset-0")
    expect(surface("full-overlay-chrome")?.className).toContain("h-12")
  })

  it("allows the full overlay consumer to style its scrim and close label", () => {
    render(
      <FullOverlay open onOpenChange={() => {}} title="Image viewer" overlayClassName="frosted-scrim" closeLabel="Close viewer">
        <p>image</p>
      </FullOverlay>,
    )

    expect(document.querySelector(".frosted-scrim")).not.toBeNull()
    expect(document.querySelector("[aria-label='Close viewer']")).not.toBeNull()
  })

  it("aligns dropdown labels on a 24px glyph column and never fills destructive items", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem icon={<span data-testid="glyph" />}>Rename</DropdownMenuItem>
          <DropdownMenuItem>Move to…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const items = Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"))
    expect(items).toHaveLength(3)

    for (const item of items) {
      expect(item.className).toContain("h-[34px]")
      expect(item.className).toContain("rounded-[7px]")
      // One item declares an icon, so every label indents on the same column.
      expect(item.querySelector(".w-6")).not.toBeNull()
    }

    const destructive = items[2]
    expect(destructive.className).toContain("focus:text-cursor")
    expect(destructive.className).not.toContain("bg-destructive")
  })
})
