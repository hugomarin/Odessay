/** @vitest-environment happy-dom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BookOpen } from "lucide-react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  FirstRunEmptyState,
  NoArtifactsEmptyState,
  NoWorkspaceEmptyState,
  STARTER_DOCUMENTS_UNAVAILABLE,
} from "@/components/shared/view-empty-states"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

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
  vi.clearAllMocks()
})

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node)
  })
}

async function click(element: Element | null) {
  if (!element) throw new Error("Expected an element to click")
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

const starters = [
  { id: "a", icon: BookOpen, title: "How Artifact Studio works", description: "What an artifact is." },
  { id: "b", icon: BookOpen, title: "Keyboard shortcuts", description: "The twelve that matter." },
]

describe("The three view states are distinct", () => {
  it("renders exactly one of the three at a time, each with its own testid", async () => {
    await render(<FirstRunEmptyState artifacts={starters} />)
    expect(container.querySelector('[data-testid="empty-state-first-run"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-state-no-artifacts"]')).toBeNull()
    expect(container.querySelector('[data-testid="empty-state-no-workspace"]')).toBeNull()
  })

  it("names the filesystem in all three — the product's differentiator", async () => {
    await render(<FirstRunEmptyState artifacts={starters} />)
    expect(container.textContent).toContain("markdown")

    await render(<NoArtifactsEmptyState />)
    expect(container.textContent).toContain("saved as markdown in that folder")

    await render(<NoWorkspaceEmptyState />)
    expect(container.textContent).toContain("a folder of yours")
    expect(container.textContent).toContain("Nothing is moved and nothing is copied")
  })

  it("carries no illustration, mascot or emoji", async () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const node of [
      <FirstRunEmptyState key="a" artifacts={starters} />,
      <NoArtifactsEmptyState key="b" />,
      <NoWorkspaceEmptyState key="c" starterWorkspaceName="Artifact Studio" />,
    ]) {
      await render(node)
      expect(emoji.test(container.textContent ?? "")).toBe(false)
      expect(container.querySelector("img")).toBeNull()
    }
  })
})

describe("First run", () => {
  it("lists the starter artifacts and never shows a progress checklist", async () => {
    await render(<FirstRunEmptyState artifacts={starters} />)
    expect(container.querySelectorAll('[data-testid^="empty-state-starter-"]')).toHaveLength(2)
    // Requirement 1: the seeded artifacts are the tutorial, so no checkbox,
    // no progress bar, no "N of M".
    expect(container.querySelector('input[type="checkbox"]')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
    expect(container.textContent).not.toMatch(/\b\d\s*(of|\/)\s*\d\b/)
  })

  it("opens a starter artifact through its handler", async () => {
    const onOpen = vi.fn()
    await render(
      <FirstRunEmptyState artifacts={[{ ...starters[0], onOpen }]} />,
    )
    await click(container.querySelector('[data-testid="empty-state-starter-a"]'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("keeps the shortcut hint the render closes the block with", async () => {
    await render(<FirstRunEmptyState artifacts={starters} />)
    expect(container.textContent).toContain("⌘N")
  })
})

describe("Connected but empty", () => {
  it("offers one primary action and one ghost", async () => {
    const onCreate = vi.fn()
    const onRestore = vi.fn()
    await render(<NoArtifactsEmptyState onCreate={onCreate} onRestoreStarters={onRestore} />)

    const buttons = Array.from(container.querySelectorAll("button"))
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      "New Artifact",
      "Restore starter documents",
    ])

    await click(buttons[0])
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it("states why restoring is unavailable instead of leaving the reason blank", async () => {
    await render(<NoArtifactsEmptyState restoreDisabledReason={STARTER_DOCUMENTS_UNAVAILABLE} />)
    const restore = container.querySelector<HTMLButtonElement>(
      '[data-testid="empty-state-restore-starters"]',
    )
    expect(restore?.disabled).toBe(true)
    expect(restore?.getAttribute("title")).toBe(STARTER_DOCUMENTS_UNAVAILABLE)
  })

  it("reports a restore failure on the state itself", async () => {
    await render(
      <NoArtifactsEmptyState status={{ tone: "error", message: "Could not write to that folder." }} />,
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not write to that folder.",
    )
  })
})

describe("No workspace connected", () => {
  it("offers the two option rows of the add-workspace flow", async () => {
    const onExisting = vi.fn()
    const onScratch = vi.fn()
    await render(
      <NoWorkspaceEmptyState
        onUseExistingFolder={onExisting}
        onCreateFromScratch={onScratch}
      />,
    )

    await click(container.querySelector('[data-testid="empty-state-use-existing-folder"]'))
    await click(container.querySelector('[data-testid="empty-state-create-from-scratch"]'))
    expect(onExisting).toHaveBeenCalledTimes(1)
    expect(onScratch).toHaveBeenCalledTimes(1)
  })

  it("names where the starter documents live, and stays quiet when there is nowhere to point", async () => {
    await render(<NoWorkspaceEmptyState starterWorkspaceName="Artifact Studio" />)
    expect(container.textContent).toContain("Artifact Studio")
    expect(container.textContent).toContain("doesn’t touch your folders")

    await render(<NoWorkspaceEmptyState />)
    expect(container.textContent).not.toContain("Meanwhile")
  })
})
