import { describe, expect, it, vi } from "vitest"
import { getEditorShortcutAction, getEditorShortcutLabel } from "@/lib/editor/shortcuts"

type ShortcutInput = {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

const shortcut = ({ key, code, metaKey = false, ctrlKey = false, shiftKey = false, altKey = false }: ShortcutInput) => ({
  key,
  code,
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
    expect(getEditorShortcutAction(shortcut({ key: "q", metaKey: true, altKey: true }))).toBe("blockquote")
    expect(getEditorShortcutAction(shortcut({ key: "p", metaKey: true, altKey: true }))).toBe("paragraph")
    expect(getEditorShortcutAction(shortcut({ key: "1", metaKey: true, altKey: true }))).toBe("heading1")
    expect(getEditorShortcutAction(shortcut({ key: "2", metaKey: true, altKey: true }))).toBe("heading2")
    expect(getEditorShortcutAction(shortcut({ key: "3", metaKey: true, altKey: true }))).toBe("heading3")
    expect(getEditorShortcutAction(shortcut({ key: "k", metaKey: true, ctrlKey: true }))).toBe("footnote")

    vi.unstubAllGlobals()
  })

  it("maps windows/linux shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutAction(shortcut({ key: "b", ctrlKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "j", ctrlKey: true, shiftKey: true }))).toBe("codeBlock")
    expect(getEditorShortcutAction(shortcut({ key: "k", ctrlKey: true, altKey: true }))).toBe("footnote")
    expect(getEditorShortcutAction(shortcut({ key: "q", ctrlKey: true, altKey: true }))).toBe("blockquote")
    expect(getEditorShortcutAction(shortcut({ key: "p", ctrlKey: true, altKey: true }))).toBe("paragraph")

    vi.unstubAllGlobals()
  })

  it("matches alt-modified keys in mac layouts using event.code", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "œ", code: "KeyQ", metaKey: true, altKey: true }))).toBe("blockquote")
    expect(getEditorShortcutAction(shortcut({ key: "π", code: "KeyP", metaKey: true, altKey: true }))).toBe("paragraph")
    expect(getEditorShortcutAction(shortcut({ key: "¡", code: "Digit1", metaKey: true, altKey: true }))).toBe("heading1")
    expect(getEditorShortcutAction(shortcut({ key: "™", code: "Digit2", metaKey: true, altKey: true }))).toBe("heading2")
    expect(getEditorShortcutAction(shortcut({ key: "£", code: "Digit3", metaKey: true, altKey: true }))).toBe("heading3")

    vi.unstubAllGlobals()
  })

  it("returns null for non-matching keys", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "x", metaKey: true }))).toBeNull()
    expect(getEditorShortcutAction(shortcut({ key: "k" }))).toBeNull()

    vi.unstubAllGlobals()
  })
})

describe("getEditorShortcutLabel", () => {
  it("formats labels for mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutLabel("bold")).toBe("⌘B")
    expect(getEditorShortcutLabel("italic")).toBe("⌘I")
    expect(getEditorShortcutLabel("blockquote")).toBe("⌘⌥Q")
    expect(getEditorShortcutLabel("paragraph")).toBe("⌘⌥P")
    expect(getEditorShortcutLabel("footnote")).toBe("⌃⌘K")
    expect(getEditorShortcutLabel("focusMode")).toBe("⌘⇧F")

    vi.unstubAllGlobals()
  })

  it("formats labels for windows/linux", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutLabel("bold")).toBe("Ctrl+B")
    expect(getEditorShortcutLabel("italic")).toBe("Ctrl+I")
    expect(getEditorShortcutLabel("blockquote")).toBe("Ctrl+Alt+Q")
    expect(getEditorShortcutLabel("paragraph")).toBe("Ctrl+Alt+P")
    expect(getEditorShortcutLabel("footnote")).toBe("Ctrl+Alt+K")
    expect(getEditorShortcutLabel("focusMode")).toBe("Ctrl+Shift+F")

    vi.unstubAllGlobals()
  })
})
