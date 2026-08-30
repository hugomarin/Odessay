/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WritingStyleSelector } from "@/components/ui/writing-style-selector"
import {
  DEFAULT_WRITING_STYLE,
  parseWritingStyle,
  WRITING_STYLE_STORAGE_KEY,
} from "@/lib/settings/writing-style"

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.dataset.writingStyle = DEFAULT_WRITING_STYLE
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  window.localStorage.clear()
  document.documentElement.dataset.writingStyle = DEFAULT_WRITING_STYLE
})

describe("writing style preference", () => {
  it("falls back to Kant for missing or invalid values", () => {
    expect(parseWritingStyle(null)).toBe("kant")
    expect(parseWritingStyle("unknown")).toBe("kant")
    expect(parseWritingStyle("quine")).toBe("quine")
  })

  it("applies and remembers a selection globally", () => {
    act(() => {
      root?.render(<WritingStyleSelector />)
    })

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Artifact style"]')
    expect(trigger?.textContent).toContain("Kant · Balanced")

    const descartes = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.includes("Descartes"))

    act(() => {
      descartes?.click()
    })

    expect(document.documentElement.dataset.writingStyle).toBe("descartes")
    expect(window.localStorage.getItem(WRITING_STYLE_STORAGE_KEY)).toBe("descartes")
    expect(trigger?.textContent).toContain("Descartes · Classic")
  })
})
