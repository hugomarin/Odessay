import { describe, expect, it } from "vitest"
import { resolveEscapeIntent } from "@/lib/editor/panel-behavior"

describe("panel escape behavior", () => {
  it("closes an open panel before exiting focus mode", () => {
    expect(resolveEscapeIntent({ hasOpenPanel: true, isFocusMode: true })).toBe("close-panel")
  })

  it("exits focus mode when no panel is open", () => {
    expect(resolveEscapeIntent({ hasOpenPanel: false, isFocusMode: true })).toBe("exit-focus")
  })

  it("does nothing when neither panel nor focus mode is active", () => {
    expect(resolveEscapeIntent({ hasOpenPanel: false, isFocusMode: false })).toBe("none")
  })
})
