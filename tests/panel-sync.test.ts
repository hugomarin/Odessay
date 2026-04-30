import { describe, expect, it, vi } from "vitest"
import { applyPanelMarkdownChange, applyPanelMetaChange } from "@/lib/editor/panel-sync"

describe("panel sync integration", () => {
  it("applies markdown change and persists after updating editor state", () => {
    const setContent = vi.fn()
    const clearPendingSave = vi.fn()
    const updateDerivedState = vi.fn()
    const persistSnapshot = vi.fn()

    const result = applyPanelMarkdownChange(
      { commands: { setContent } },
      "Body[^1]\n\n[^1]: Note",
      {
        clearPendingSave,
        updateDerivedState,
        persistSnapshot,
      },
    )

    expect(result).toBe(true)
    expect(clearPendingSave).toHaveBeenCalledTimes(1)
    expect(setContent).toHaveBeenCalledWith("Body[^1]\n\n[^1]: Note")
    expect(updateDerivedState).toHaveBeenCalledTimes(1)
    expect(persistSnapshot).toHaveBeenCalledWith()
  })

  it("persists status updates from properties panel", () => {
    const persistSnapshot = vi.fn()

    const result = applyPanelMetaChange(
      { commands: { setContent: vi.fn() } },
      { status: "done" },
      { persistSnapshot },
    )

    expect(result).toBe(true)
    expect(persistSnapshot).toHaveBeenCalledWith({ status: "done" })
  })
})
