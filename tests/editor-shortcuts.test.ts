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
  it("maps mac format + structure shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "b", code: "KeyB", metaKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "i", code: "KeyI", metaKey: true }))).toBe("italic")
    expect(getEditorShortcutAction(shortcut({ key: "x", code: "KeyX", metaKey: true, shiftKey: true }))).toBe("strike")
    expect(getEditorShortcutAction(shortcut({ key: "h", code: "KeyH", metaKey: true, shiftKey: true }))).toBe("highlight")
    expect(getEditorShortcutAction(shortcut({ key: "e", code: "KeyE", metaKey: true }))).toBe("inlineCode")
    expect(getEditorShortcutAction(shortcut({ key: "e", code: "KeyE", metaKey: true, shiftKey: true }))).toBe("codeBlock")
    expect(getEditorShortcutAction(shortcut({ key: "k", code: "KeyK", metaKey: true, shiftKey: true }))).toBe("link")

    expect(getEditorShortcutAction(shortcut({ key: "0", code: "Digit0", metaKey: true }))).toBe("paragraph")
    expect(getEditorShortcutAction(shortcut({ key: "1", code: "Digit1", metaKey: true }))).toBe("heading1")
    expect(getEditorShortcutAction(shortcut({ key: "2", code: "Digit2", metaKey: true }))).toBe("heading2")
    expect(getEditorShortcutAction(shortcut({ key: "3", code: "Digit3", metaKey: true }))).toBe("heading3")
    expect(getEditorShortcutAction(shortcut({ key: "l", code: "KeyL", metaKey: true }))).toBe("bulletList")
    expect(getEditorShortcutAction(shortcut({ key: "l", code: "KeyL", metaKey: true, shiftKey: true }))).toBe("orderedList")
    expect(getEditorShortcutAction(shortcut({ key: "b", code: "KeyB", metaKey: true, shiftKey: true }))).toBe("blockquote")

    vi.unstubAllGlobals()
  })

  it("maps mac insert + navigate + annotate shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutAction(shortcut({ key: "a", code: "KeyA", metaKey: true, shiftKey: true }))).toBe("footnote")
    expect(getEditorShortcutAction(shortcut({ key: "t", code: "KeyT", metaKey: true }))).toBe("table")
    expect(getEditorShortcutAction(shortcut({ key: "i", code: "KeyI", metaKey: true, shiftKey: true }))).toBe("image")
    expect(getEditorShortcutAction(shortcut({ key: "-", code: "Minus", metaKey: true, shiftKey: true }))).toBe("horizontalRule")

    expect(getEditorShortcutAction(shortcut({ key: "1", code: "Digit1", metaKey: true, altKey: true }))).toBe("goDesk")
    expect(getEditorShortcutAction(shortcut({ key: "2", code: "Digit2", metaKey: true, altKey: true }))).toBe("goWorkspace")
    expect(getEditorShortcutAction(shortcut({ key: "3", code: "Digit3", metaKey: true, altKey: true }))).toBe("goStudio")
    expect(getEditorShortcutAction(shortcut({ key: "k", code: "KeyK", metaKey: true }))).toBe("search")
    expect(getEditorShortcutAction(shortcut({ key: "]", code: "BracketRight", metaKey: true, shiftKey: true }))).toBe("nextTab")
    expect(getEditorShortcutAction(shortcut({ key: "[", code: "BracketLeft", metaKey: true, shiftKey: true }))).toBe("prevTab")

    expect(getEditorShortcutAction(shortcut({ key: "n", code: "KeyN", metaKey: true, shiftKey: true }))).toBe("addNote")
    expect(getEditorShortcutAction(shortcut({ key: "r", code: "KeyR", metaKey: true, altKey: true }))).toBe("voiceNote")
    expect(getEditorShortcutAction(shortcut({ key: "p", code: "KeyP", metaKey: true, altKey: true }))).toBe("documentProperties")

    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", metaKey: true }))).toBe("find")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", metaKey: true, altKey: true }))).toBe("replace")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", metaKey: true, shiftKey: true }))).toBe("focusMode")
    expect(getEditorShortcutAction(shortcut({ key: "\\", code: "Backslash", metaKey: true }))).toBe("toggleSidebar")
    expect(getEditorShortcutAction(shortcut({ key: "/", code: "Slash", metaKey: true }))).toBe("shortcutHelp")
    expect(getEditorShortcutAction(shortcut({ key: ",", code: "Comma", metaKey: true }))).toBe("settings")

    vi.unstubAllGlobals()
  })

  it("maps windows/linux shortcuts", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutAction(shortcut({ key: "b", code: "KeyB", ctrlKey: true }))).toBe("bold")
    expect(getEditorShortcutAction(shortcut({ key: "e", code: "KeyE", ctrlKey: true }))).toBe("inlineCode")
    expect(getEditorShortcutAction(shortcut({ key: "e", code: "KeyE", ctrlKey: true, shiftKey: true }))).toBe("codeBlock")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", ctrlKey: true }))).toBe("find")
    expect(getEditorShortcutAction(shortcut({ key: "f", code: "KeyF", ctrlKey: true, altKey: true }))).toBe("replace")
    expect(getEditorShortcutAction(shortcut({ key: "a", code: "KeyA", ctrlKey: true, shiftKey: true }))).toBe("footnote")
    expect(getEditorShortcutAction(shortcut({ key: "k", code: "KeyK", ctrlKey: true }))).toBe("search")
    expect(getEditorShortcutAction(shortcut({ key: "1", code: "Digit1", ctrlKey: true, altKey: true }))).toBe("goDesk")
    expect(getEditorShortcutAction(shortcut({ key: "/", code: "Slash", ctrlKey: true }))).toBe("shortcutHelp")
    expect(getEditorShortcutAction(shortcut({ key: ",", code: "Comma", ctrlKey: true }))).toBe("settings")

    vi.unstubAllGlobals()
  })

  it("matches alt (⌥) combos on macOS via event.code when key is an alternate glyph", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    // ⌥1 → "¡", ⌥r → "®": key is an alternate glyph, code stays stable.
    expect(getEditorShortcutAction(shortcut({ key: "¡", code: "Digit1", metaKey: true, altKey: true }))).toBe("goDesk")
    expect(getEditorShortcutAction(shortcut({ key: "®", code: "KeyR", metaKey: true, altKey: true }))).toBe("voiceNote")

    vi.unstubAllGlobals()
  })

  it("returns null for non-matching keys", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    // ⌘X alone is Cut, not a shortcut here.
    expect(getEditorShortcutAction(shortcut({ key: "x", code: "KeyX", metaKey: true }))).toBeNull()
    expect(getEditorShortcutAction(shortcut({ key: "k" }))).toBeNull()
    expect(getEditorShortcutAction(shortcut({ key: "u", metaKey: true, altKey: true, shiftKey: true }))).toBeNull()

    vi.unstubAllGlobals()
  })
})

describe("getEditorShortcutLabel", () => {
  it("formats labels for mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutLabel("bold")).toBe("⌘B")
    expect(getEditorShortcutLabel("inlineCode")).toBe("⌘E")
    expect(getEditorShortcutLabel("blockquote")).toBe("⌘⇧B")
    expect(getEditorShortcutLabel("heading3")).toBe("⌘3")
    expect(getEditorShortcutLabel("footnote")).toBe("⌘⇧A")
    expect(getEditorShortcutLabel("search")).toBe("⌘K")
    expect(getEditorShortcutLabel("link")).toBe("⌘⇧K")
    expect(getEditorShortcutLabel("goDesk")).toBe("⌘⌥1")
    expect(getEditorShortcutLabel("voiceNote")).toBe("⌘⌥R")
    expect(getEditorShortcutLabel("toggleSidebar")).toBe("⌘\\")
    expect(getEditorShortcutLabel("replace")).toBe("⌘⌥F")

    vi.unstubAllGlobals()
  })

  it("formats labels for windows/linux", () => {
    vi.stubGlobal("navigator", { platform: "Win32" })

    expect(getEditorShortcutLabel("bold")).toBe("Ctrl+B")
    expect(getEditorShortcutLabel("inlineCode")).toBe("Ctrl+E")
    expect(getEditorShortcutLabel("heading3")).toBe("Ctrl+3")
    expect(getEditorShortcutLabel("search")).toBe("Ctrl+K")
    expect(getEditorShortcutLabel("goDesk")).toBe("Ctrl+Alt+1")
    expect(getEditorShortcutLabel("replace")).toBe("Ctrl+Alt+F")

    vi.unstubAllGlobals()
  })

  it("returns empty string for menu-only actions", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" })

    expect(getEditorShortcutLabel("clearStyles")).toBe("")
    expect(getEditorShortcutLabel("date")).toBe("")

    vi.unstubAllGlobals()
  })
})
