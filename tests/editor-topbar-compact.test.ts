import { describe, expect, it, vi } from "vitest"
import {
  EDITOR_TOPBAR_COMPACT_FORMAT_CLASS,
  EDITOR_TOPBAR_COMPACT_TRIGGER_ID,
  EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS,
  EDITOR_TOPBAR_TITLE_CONTAINER_CLASS,
  runCompactTopbarAction,
} from "@/lib/editor/topbar-compact"

describe("editor topbar compact responsive behavior", () => {
  it("defines breakpoint classes and trigger id for compact mode", () => {
    expect(EDITOR_TOPBAR_COMPACT_TRIGGER_ID).toBe("editor-format-menu-trigger")

    expect(EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS).toContain("min-[960px]:flex")
    expect(EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS).toContain("hidden")

    expect(EDITOR_TOPBAR_COMPACT_FORMAT_CLASS).toContain("min-[960px]:hidden")
    expect(EDITOR_TOPBAR_TITLE_CONTAINER_CLASS).toContain("min-[960px]:px-[280px]")
  })

  it("runs compact dropdown action and prevents default when event exists", () => {
    const onRunAction = vi.fn()
    const preventDefault = vi.fn()

    runCompactTopbarAction(onRunAction, "bold", { event: { preventDefault } })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onRunAction).toHaveBeenCalledWith("bold", undefined)
  })

  it("runs compact dropdown action without event", () => {
    const onRunAction = vi.fn()

    runCompactTopbarAction(onRunAction, "heading1")

    expect(onRunAction).toHaveBeenCalledWith("heading1", undefined)
  })
})
