import { describe, expect, it, vi } from "vitest"
import { getEditorShortcutAction } from "@/lib/editor/shortcuts"

type ShortcutInput = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

const shortcut = ({ key, metaKey = false, ctrlKey = false, shiftKey = false, altKey = false }: ShortcutInput) => ({
  key,
  metaKey,
  ctrlKey,
  shiftKey,
  altKey,
})

describe("getEditorShortcutAction", () => {
  it("maps mac shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "b", metaKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "u", metaKey: true, altKey: true }))).toBe("strike")
    expect(getEditorShortcutAction(shortcut({ key: "u", metaKey: true, shiftKey: true }))).toBe("highlight")
    expect(getEditorShortcutAction(shortcut({ key: "f", metaKey: true, shiftKey: true }))).toBe("focusMode")
    expect(getEditorShortcutAction(shortcut({ key: "k", metaKey: true, ctrlKey: true }))).toBe("footnote")

    vi.unstubAllGlobals()
  })

  it("maps windows/linux shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutAction(shortcut({ key: "b", ctrlKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "j", ctrlKey: true, shiftKey: true }))).toBe("codeBlock")
    expect(getEditorShortcutAction(shortcut({ key: "k", ctrlKey: true, altKey: true }))).toBe("footnote")

    vi.unstubAllGlobals()
  })

  it("returns null for non-matching keys", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "x", metaKey: true }))).toBeNull()
    expect(getEditorShortcutAction(shortcut({ key: "k" }))).toBeNull()

    vi.unstubAllGlobals()
  })
})
