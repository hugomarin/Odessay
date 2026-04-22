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

    expect(getEditorShortcutAction(shortcut({ key: "b", code: "KeyB", metaKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "i", code: "KeyI", metaKey: true }))).toBe("italic")
    expect(getEditorShortcutAction(shortcut({ key: "x", code: "KeyX", metaKey: true, shiftKey: true }))).toBe("strike")
    expect(getEditorShortcutAction(shortcut({ key: "h", code: "KeyH", metaKey: true, shiftKey: true }))).toBe("highlight")
    expect(getEditorShortcutAction(shortcut({ key: "c", code: "KeyC", metaKey: true, shiftKey: true }))).toBe("inlineCode")
    expect(getEditorShortcutAction(shortcut({ key: "d", code: "KeyD", metaKey: true, shiftKey: true }))).toBe("codeBlock")
    expect(getEditorShortcutAction(shortcut({ key: "k", code: "KeyK", metaKey: true }))).toBe("link")
    expect(getEditorShortcutAction(shortcut({ key: "a", code: "KeyA", metaKey: true, shiftKey: true }))).toBe("footnote")
    expect(getEditorShortcutAction(shortcut({ key: "0", code: "Digit0", metaKey: true, shiftKey: true }))).toBe("paragraph")
    expect(getEditorShortcutAction(shortcut({ key: "1", code: "Digit1", metaKey: true, shiftKey: true }))).toBe("heading1")
    expect(getEditorShortcutAction(shortcut({ key: "2", code: "Digit2", metaKey: true, shiftKey: true }))).toBe("heading2")
    expect(getEditorShortcutAction(shortcut({ key: "9", code: "Digit9", metaKey: true, shiftKey: true }))).toBe("heading3")
    expect(getEditorShortcutAction(shortcut({ key: "6", code: "Digit6", metaKey: true, shiftKey: true }))).toBe("blockquote")
    expect(getEditorShortcutAction(shortcut({ key: "l", code: "KeyL", metaKey: true, shiftKey: true }))).toBe("bulletList")
    expect(getEditorShortcutAction(shortcut({ key: "o", code: "KeyO", metaKey: true, shiftKey: true }))).toBe("orderedList")
    expect(getEditorShortcutAction(shortcut({ key: "t", code: "KeyT", metaKey: true, shiftKey: true }))).toBe("table")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", metaKey: true }))).toBe("find")
    expect(getEditorShortcutAction(shortcut({ key: "h", code: "KeyH", metaKey: true }))).toBe("replace")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", metaKey: true, shiftKey: true }))).toBe("focusMode")
    expect(getEditorShortcutAction(shortcut({ key: "n", code: "KeyN", metaKey: true, shiftKey: true }))).toBe("newWriting")
    expect(getEditorShortcutAction(shortcut({ key: ",", code: "Comma", metaKey: true }))).toBe("settings")

    vi.unstubAllGlobals()
  })

  it("maps windows/linux shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutAction(shortcut({ key: "b", code: "KeyB", ctrlKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "i", code: "KeyI", ctrlKey: true }))).toBe("italic")
    expect(getEditorShortcutAction(shortcut({ key: "d", code: "KeyD", ctrlKey: true, shiftKey: true }))).toBe("codeBlock")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", ctrlKey: true }))).toBe("find")
    expect(getEditorShortcutAction(shortcut({ key: "h", code: "KeyH", ctrlKey: true }))).toBe("replace")
    expect(getEditorShortcutAction(shortcut({ key: "a", code: "KeyA", ctrlKey: true, shiftKey: true }))).toBe("footnote")
    expect(getEditorShortcutAction(shortcut({ key: "6", code: "Digit6", ctrlKey: true, shiftKey: true }))).toBe("blockquote")
    expect(getEditorShortcutAction(shortcut({ key: "0", code: "Digit0", ctrlKey: true, shiftKey: true }))).toBe("paragraph")
    expect(getEditorShortcutAction(shortcut({ key: ",", code: "Comma", ctrlKey: true }))).toBe("settings")

    vi.unstubAllGlobals()
  })

  it("matches shifted symbol keys using event.code", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }))).toBe("heading1")
    expect(getEditorShortcutAction(shortcut({ key: ")", code: "Digit0", metaKey: true, shiftKey: true }))).toBe("paragraph")

    vi.unstubAllGlobals()
  })

  it("returns null for non-matching keys", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "x", metaKey: true }))).toBeNull()
    expect(getEditorShortcutAction(shortcut({ key: "k" }))).toBeNull()
    expect(getEditorShortcutAction(shortcut({ key: "u", metaKey: true, altKey: true, shiftKey: true }))).toBeNull()

    vi.unstubAllGlobals()
  })
})

describe("getEditorShortcutLabel", () => {
  it("formats labels for mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutLabel("bold")).toBe("⌘B")
    expect(getEditorShortcutLabel("italic")).toBe("⌘I")
    expect(getEditorShortcutLabel("blockquote")).toBe("⌘⇧6")
    expect(getEditorShortcutLabel("paragraph")).toBe("⌘⇧0")
    expect(getEditorShortcutLabel("footnote")).toBe("⌘⇧A")
    expect(getEditorShortcutLabel("focusMode")).toBe("⌘⇧F")
    expect(getEditorShortcutLabel("newWriting")).toBe("⌘⇧N")
    expect(getEditorShortcutLabel("settings")).toBe("⌘,")
    expect(getEditorShortcutLabel("find")).toBe("⌘F")
    expect(getEditorShortcutLabel("replace")).toBe("⌘H")

    vi.unstubAllGlobals()
  })

  it("formats labels for windows/linux", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutLabel("bold")).toBe("Ctrl+B")
    expect(getEditorShortcutLabel("italic")).toBe("Ctrl+I")
    expect(getEditorShortcutLabel("blockquote")).toBe("Ctrl+Shift+6")
    expect(getEditorShortcutLabel("paragraph")).toBe("Ctrl+Shift+0")
    expect(getEditorShortcutLabel("footnote")).toBe("Ctrl+Shift+A")
    expect(getEditorShortcutLabel("focusMode")).toBe("Ctrl+Shift+F")
    expect(getEditorShortcutLabel("newWriting")).toBe("Ctrl+Shift+N")
    expect(getEditorShortcutLabel("settings")).toBe("Ctrl+,")
    expect(getEditorShortcutLabel("find")).toBe("Ctrl+F")
    expect(getEditorShortcutLabel("replace")).toBe("Ctrl+H")

    vi.unstubAllGlobals()
  })
})
