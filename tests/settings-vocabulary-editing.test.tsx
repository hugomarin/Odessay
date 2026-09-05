/** @vitest-environment happy-dom */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VocabularyList } from "@/components/settings/vocabulary-list"
import type { VocabularyItem as SettingsVocabularyItem } from "@/lib/settings/vocabulary"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const createVocabularyItem = vi.fn()
const updateVocabularyItem = vi.fn()
const deleteVocabularyItem = vi.fn()
const getVocabularyUsage = vi.fn()

vi.mock("@/components/settings/user-settings-provider", () => ({
  useUserSettingsContext: () => ({
    settings: { disabledStatuses: [], vocabulary: [] },
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    update: vi.fn(),
    createVocabularyItem,
    updateVocabularyItem,
    deleteVocabularyItem,
    getVocabularyUsage,
  }),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  createVocabularyItem.mockReset()
  updateVocabularyItem.mockReset()
  deleteVocabularyItem.mockReset()
  getVocabularyUsage.mockReset()
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
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

async function type(input: Element | null, value: string) {
  if (!input) throw new Error("Expected an input")
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
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

function customItem(overrides: Partial<SettingsVocabularyItem> = {}): SettingsVocabularyItem {
  return {
    id: "row-1",
    name: "Research",
    description: "",
    icon: "compass",
    color: "#5B5BD6",
    locked: false,
    ...overrides,
  }
}

function baseItem(overrides: Partial<SettingsVocabularyItem> = {}): SettingsVocabularyItem {
  return {
    id: "general",
    name: "General",
    description: "",
    icon: "file-text",
    color: "#1E1915",
    locked: true,
    lockNote: "Base type: you can change its name, icon, color and description, not delete it.",
    ...overrides,
  }
}

describe("VocabularyList save/delete wiring (ODE-475)", () => {
  it("creates a custom item and the row reflects it without navigating away", async () => {
    createVocabularyItem.mockResolvedValue(customItem())
    await render(<VocabularyList kind="type" items={[]} addLabel="New type" />)

    await click(byText("New type", container))
    await type(document.getElementById("vocabulary-name"), "Research")
    await click(byText("Save", modal() as ParentNode))

    expect(createVocabularyItem).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "type", name: "Research" }),
    )
    // The modal closed on success — no error, no lingering draft.
    expect(modal()).toBeNull()
  })

  it("keeps the modal open with the error visible and the draft intact when save fails", async () => {
    updateVocabularyItem.mockRejectedValue(new Error("Network is offline."))
    await render(<VocabularyList kind="type" items={[customItem()]} addLabel="New type" />)

    await click(byText("Edit", container))
    await type(document.getElementById("vocabulary-name"), "Renamed")
    await click(byText("Save", modal() as ParentNode))

    expect(modal()).not.toBeNull()
    expect(modal()?.textContent).toContain("Network is offline.")
    expect((document.getElementById("vocabulary-name") as HTMLInputElement).value).toBe("Renamed")
  })

  it("shows the lock note and no Delete action for a base item", async () => {
    await render(<VocabularyList kind="type" items={[baseItem()]} addLabel="New type" />)
    await click(byText("Edit", container))

    expect(modal()?.textContent).toContain("not delete it")
    expect(byText("Delete", modal() as ParentNode)).toBeNull()
  })

  it("names the item, states the base value, and shows the real count before deleting", async () => {
    getVocabularyUsage.mockResolvedValue({ "row-1": 3 })
    deleteVocabularyItem.mockResolvedValue({ rewrittenCount: 3 })
    await render(<VocabularyList kind="type" items={[customItem()]} addLabel="New type" />)

    await click(byText("Edit", container))
    await click(byText("Delete", modal() as ParentNode))

    const confirm = document.querySelector('[data-testid="vocabulary-delete-confirm"]')
    expect(confirm?.textContent).toContain("Research")
    await act(async () => {
      await Promise.resolve()
    })
    expect(confirm?.textContent).toContain("3 artifacts will be rewritten to General")
    expect(confirm?.textContent).not.toBe("OK")
  })

  it("says the count is unavailable instead of showing zero when usage could not be taken", async () => {
    getVocabularyUsage.mockResolvedValue(null)
    await render(<VocabularyList kind="status" items={[customItem({ id: "row-2", name: "Blocked" })]} addLabel="New status" />)

    await click(byText("Edit", container))
    await click(byText("Delete", modal() as ParentNode))
    await act(async () => {
      await Promise.resolve()
    })

    const confirm = document.querySelector('[data-testid="vocabulary-delete-confirm"]')
    expect(confirm?.textContent).toContain("couldn't count")
    expect(confirm?.textContent).not.toContain("0 artifact")
  })

  it("cancelling the delete confirmation touches nothing", async () => {
    getVocabularyUsage.mockResolvedValue({ "row-1": 1 })
    await render(<VocabularyList kind="type" items={[customItem()]} addLabel="New type" />)

    await click(byText("Edit", container))
    await click(byText("Delete", modal() as ParentNode))
    await act(async () => {
      await Promise.resolve()
    })
    await click(byText("Cancel", document.querySelector('[data-testid="vocabulary-delete-confirm"]') as ParentNode))

    expect(deleteVocabularyItem).not.toHaveBeenCalled()
    // Back to the editor, not closed — the delete confirm is a step inside
    // the same flow, never a stacked second modal.
    expect(modal()).not.toBeNull()
  })

  it("confirming delete calls through and closes the modal", async () => {
    getVocabularyUsage.mockResolvedValue({ "row-1": 0 })
    deleteVocabularyItem.mockResolvedValue({ rewrittenCount: 0 })
    await render(<VocabularyList kind="type" items={[customItem()]} addLabel="New type" />)

    await click(byText("Edit", container))
    await click(byText("Delete", modal() as ParentNode))
    await act(async () => {
      await Promise.resolve()
    })
    await click(byText("Delete type", document.querySelector('[data-testid="vocabulary-delete-confirm"]') as ParentNode))

    expect(deleteVocabularyItem).toHaveBeenCalledWith("row-1")
    expect(modal()).toBeNull()
  })
})
