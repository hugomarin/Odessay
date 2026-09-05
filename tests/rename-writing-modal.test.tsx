/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-478 follow-up — a rejection from onConfirm (not just a
 * resolved `false`) must not strand the modal showing "Saving…" forever with
 * no way to recover but Cancel.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/services/ai-service-factory", () => ({
  getAIService: () => ({
    suggestTitle: vi.fn(),
  }),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ""
})

function findButton(text: string) {
  return Array.from(document.querySelectorAll("button")).find((button) => button.textContent === text) ?? null
}

async function flushMicrotasks(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

describe("RenameWritingModal — ODE-478 follow-up", () => {
  it('shows an error and re-enables Save instead of getting stuck on "Saving…" when onConfirm rejects', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error("desktop runtime unavailable")
    })
    const onOpenChange = vi.fn()

    act(() => {
      root.render(
        <RenameWritingModal open title="Untitled artifact" onOpenChange={onOpenChange} onConfirm={onConfirm} />,
      )
    })

    await act(async () => {
      findButton("Save name")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    // Never closes as if it worked, and never leaves the modal permanently
    // disabled — Save must be clickable again with the error visible.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(document.body.textContent).toContain("desktop runtime unavailable")
    expect(findButton("Saving…")).toBeNull()
    expect(findButton("Save name")).not.toBeNull()
    expect(findButton("Save name")?.hasAttribute("disabled")).toBe(false)
  })

  it("closes normally when onConfirm resolves true", async () => {
    const onConfirm = vi.fn(async () => true)
    const onOpenChange = vi.fn()

    act(() => {
      root.render(
        <RenameWritingModal open title="Untitled artifact" onOpenChange={onOpenChange} onConfirm={onConfirm} />,
      )
    })

    await act(async () => {
      findButton("Save name")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await flushMicrotasks()
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
