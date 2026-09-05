/** @vitest-environment happy-dom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ArtifactTypeSettings from "@/components/settings/artifact-type-settings"
import WritingStatusSettings from "@/components/settings/writing-status-settings"
import { VocabularyList } from "@/components/settings/vocabulary-list"
import {
  ARTIFACT_TYPE_ICON_NAMES,
  VOCABULARY_COLORS,
  WRITING_STATUS_ICON_NAMES,
  getArtifactTypeVocabulary,
  getWritingStatusVocabulary,
} from "@/lib/settings/vocabulary"
import { ARTIFACT_TYPE_VALUES } from "@/lib/writings/artifact-type"
import { WRITING_STATUS_VALUES } from "@/lib/writings/status"
import type { WritingStatus } from "@/lib/writings/status"
import { getVocabularyCatalogSnapshot, resetVocabularyCatalogForTest, setVocabularyCatalog } from "@/lib/vocabulary/catalog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const update = vi.fn().mockResolvedValue(undefined)
const createVocabularyItem = vi.fn().mockResolvedValue(undefined)
const updateVocabularyItem = vi.fn().mockResolvedValue(undefined)
const deleteVocabularyItem = vi.fn().mockResolvedValue({ rewrittenCount: 0 })
const getVocabularyUsage = vi.fn().mockResolvedValue(null)
let disabledStatuses: WritingStatus[] = []

vi.mock("@/components/settings/user-settings-provider", () => ({
  useUserSettingsContext: () => ({
    settings: { disabledStatuses, vocabulary: [] },
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    update,
    createVocabularyItem,
    updateVocabularyItem,
    deleteVocabularyItem,
    getVocabularyUsage,
  }),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  disabledStatuses = []
  resetVocabularyCatalogForTest()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
  resetVocabularyCatalogForTest()
})

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node)
  })
}

async function click(element: Element | null) {
  if (!element) throw new Error("Expected an element to click")
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

function byText(name: string, scope: ParentNode = document) {
  return (
    Array.from(scope.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
    ) ?? null
  )
}

function modal() {
  return document.querySelector('[data-testid="form-modal"]')
}

describe("Settings vocabulary", () => {
  it("renders one card per artifact type in the repo's catalogue", async () => {
    await render(<ArtifactTypeSettings />)
    expect(container.querySelectorAll('[data-testid^="vocabulary-item-"]')).toHaveLength(
      ARTIFACT_TYPE_VALUES.length,
    )
    // Types have no "show in menus" switch — that shape belongs to statuses.
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0)
  })

  it("renders one card per status, with a switch and the Required marker on draft", async () => {
    await render(<WritingStatusSettings />)
    expect(container.querySelectorAll('[data-testid^="vocabulary-item-"]')).toHaveLength(
      WRITING_STATUS_VALUES.length,
    )
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(WRITING_STATUS_VALUES.length)

    const draft = container.querySelector('[data-testid="vocabulary-item-base:status:draft"]')!
    expect(draft.textContent).toContain("Required")
    expect(draft.querySelector('[role="switch"]')?.hasAttribute("disabled")).toBe(true)
  })

  it("hides a status through the real vocabulary CRUD and never rewrites artifacts (ODE-476)", async () => {
    await render(<WritingStatusSettings />)
    const canceled = container.querySelector('[data-testid="vocabulary-item-base:status:canceled"]')!
    await click(canceled.querySelector('[role="switch"]'))

    // Requirement 9: the only write is the item's own `hidden` flag. No
    // artifact mutation, no confirmation asking to move anything to Draft.
    expect(updateVocabularyItem).toHaveBeenCalledWith("base:status:canceled", { hidden: true })
    expect(document.body.textContent).not.toContain("Move to Draft")
  })

  it("opens the editor from the add row without ever adding an untitled row", async () => {
    await render(<ArtifactTypeSettings />)
    const before = container.querySelectorAll('[data-testid^="vocabulary-item-"]').length

    await click(byText("New type", container))

    expect(modal()).not.toBeNull()
    expect(modal()?.textContent).toContain("New type")
    // Requirement 6: the list is untouched until something is saved.
    expect(container.querySelectorAll('[data-testid^="vocabulary-item-"]')).toHaveLength(before)
  })

  it("offers exactly thirty-two type icons and twelve colors", async () => {
    await render(<ArtifactTypeSettings />)
    await click(byText("Edit", container))

    const grids = modal()!.querySelectorAll('[role="radiogroup"]')
    expect(grids[0].querySelectorAll('[role="radio"]')).toHaveLength(
      ARTIFACT_TYPE_ICON_NAMES.length,
    )
    expect(ARTIFACT_TYPE_ICON_NAMES).toHaveLength(32)
    expect(grids[1].querySelectorAll('[role="radio"]')).toHaveLength(VOCABULARY_COLORS.length)
    expect(VOCABULARY_COLORS).toHaveLength(12)
  })

  it("offers exactly twenty-six status icons", async () => {
    await render(<WritingStatusSettings />)
    await click(byText("Edit", container))

    const grids = modal()!.querySelectorAll('[role="radiogroup"]')
    expect(grids[0].querySelectorAll('[role="radio"]')).toHaveLength(
      WRITING_STATUS_ICON_NAMES.length,
    )
    expect(WRITING_STATUS_ICON_NAMES).toHaveLength(26)
  })

  it("shows the lock note instead of a delete action on a built-in item", async () => {
    await render(<ArtifactTypeSettings />)
    await click(byText("Edit", container))

    expect(modal()?.textContent).toContain("not delete it")
    expect(byText("Delete", modal() as ParentNode)).toBeNull()
  })

  it("states why a disabled control is disabled", async () => {
    await render(
      <VocabularyList
        kind="type"
        items={[
          {
            id: "blank",
            name: "",
            description: "",
            icon: "book-open",
            color: "#5B5BD6",
            locked: false,
          },
        ]}
        addLabel="New type"
      />,
    )
    await click(byText("Edit", container))

    // ODE-475 requirement 8: AI assistance is out of scope for this release
    // (owner decision, 2026-08-30) — a single reason regardless of whether
    // there's a name/description to work from, not "not wired yet".
    const improve = byText("Improve with AI", modal() as ParentNode)
    expect(improve?.getAttribute("title")).toBe(
      "AI assistance for the vocabulary editor is out of scope for this release.",
    )
    for (const disabled of Array.from(modal()!.querySelectorAll("button[disabled]"))) {
      expect(disabled.getAttribute("title")).toBeTruthy()
    }
  })
})

describe("Settings vocabulary seeds", () => {
  it("keeps the palette in the order the prototype declares, brighter additions after", () => {
    expect(VOCABULARY_COLORS.map((color) => color.name)).toEqual([
      "Ink",
      "Terracotta",
      "Amber",
      "Green",
      "Violet",
      "Grey",
      "Red",
      "Pink",
      "Blue",
      "Lime",
      "Orange",
      "Yellow",
    ])
  })

  it("locks (blocks delete on) every built-in type and status, but requires only draft (ODE-475)", () => {
    expect(getArtifactTypeVocabulary().every((item) => item.locked)).toBe(true)
    // Every base status blocks delete...
    expect(getWritingStatusVocabulary().every((item) => item.locked)).toBe(true)
    // ...but only draft is required (cannot be hidden either).
    const required = getWritingStatusVocabulary().filter((item) => item.required)
    expect(required).toHaveLength(1)
    expect(required[0]?.id).toBe("base:status:draft")
  })

  it("reads enabled state from the catalog item's own hidden flag (ODE-476)", () => {
    const catalog = getVocabularyCatalogSnapshot()
    setVocabularyCatalog(
      catalog.map((item) => (item.key === "canceled" && item.kind === "status" ? { ...item, hidden: true } : item)),
    )

    const items = getWritingStatusVocabulary()
    expect(items.find((item) => item.id === "base:status:canceled")?.enabled).toBe(false)
    expect(items.find((item) => item.id === "base:status:done")?.enabled).toBe(true)
  })
})
