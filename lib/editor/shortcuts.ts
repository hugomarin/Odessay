import { getShortcutForPlatform, isMacPlatform, type ShortcutDisplay } from "@/lib/keyboard-shortcuts"

export type EditorShortcutAction =
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "inlineCode"
  | "codeBlock"
  | "link"
  | "footnote"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "focusMode"
  | "newWriting"
  | "settings"
  | "table"

export type KeyboardLikeEvent = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const EDITOR_SHORTCUT_LABELS: Record<EditorShortcutAction, ShortcutDisplay> = {
  bold: { mac: "⌘⇧H", windows: "Ctrl+Shift+H" },
  italic: { mac: "⌘⇧L", windows: "Ctrl+Shift+L" },
  strike: { mac: "⌘⇧X", windows: "Ctrl+Shift+X" },
  highlight: { mac: "⌘⇧U", windows: "Ctrl+Shift+U" },
  inlineCode: { mac: "⌘⇧E", windows: "Ctrl+Shift+E" },
  codeBlock: { mac: "⌘⇧D", windows: "Ctrl+Shift+D" },
  link: { mac: "⌘⇧K", windows: "Ctrl+Shift+K" },
  footnote: { mac: "⌘⇧A", windows: "Ctrl+Shift+A" },
  paragraph: { mac: "⌘⇧4", windows: "Ctrl+Shift+4" },
  heading1: { mac: "⌘⇧1", windows: "Ctrl+Shift+1" },
  heading2: { mac: "⌘⇧2", windows: "Ctrl+Shift+2" },
  heading3: { mac: "⌘⇧3", windows: "Ctrl+Shift+3" },
  blockquote: { mac: "⌘⇧5", windows: "Ctrl+Shift+5" },
  bulletList: { mac: "⌘⇧6", windows: "Ctrl+Shift+6" },
  orderedList: { mac: "⌘⇧7", windows: "Ctrl+Shift+7" },
  focusMode: { mac: "⌘⇧F", windows: "Ctrl+Shift+F" },
  newWriting: { mac: "⌘⇧Y", windows: "Ctrl+Shift+Y" },
  settings: { mac: "⌘⇧<", windows: "Ctrl+Shift+<" },
  table: { mac: "⌘⇧8", windows: "Ctrl+Shift+8" },
}

const isCommandKey = (event: KeyboardLikeEvent) =>
  isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey

const hasNoExtraModifiers = (event: KeyboardLikeEvent, options: { shift?: boolean } = {}) =>
  event.shiftKey === (options.shift ?? false) && !event.altKey

const matchesKey = (event: KeyboardLikeEvent, key: string, code?: string) => {
  if (event.key.toLowerCase() === key) {
    return true
  }

  if (!code || !event.code) {
    return false
  }

  return event.code === code
}

const matches = (event: KeyboardLikeEvent, key: string, options: { shift?: boolean; code?: string } = {}) =>
  matchesKey(event, key, options.code) && isCommandKey(event) && hasNoExtraModifiers(event, options)

export const getEditorShortcutAction = (event: KeyboardLikeEvent): EditorShortcutAction | null => {
  if (matches(event, "h", { shift: true, code: "KeyH" })) {
    return "bold"
  }

  if (matches(event, "l", { shift: true, code: "KeyL" })) {
    return "italic"
  }

  if (matches(event, "x", { shift: true, code: "KeyX" })) {
    return "strike"
  }

  if (matches(event, "u", { shift: true, code: "KeyU" })) {
    return "highlight"
  }

  if (matches(event, "e", { shift: true, code: "KeyE" })) {
    return "inlineCode"
  }

  if (matches(event, "d", { shift: true, code: "KeyD" })) {
    return "codeBlock"
  }

  if (matches(event, "k", { shift: true, code: "KeyK" })) {
    return "link"
  }

  if (matches(event, "a", { shift: true, code: "KeyA" })) {
    return "footnote"
  }

  if (matches(event, "4", { shift: true, code: "Digit4" })) {
    return "paragraph"
  }

  if (matches(event, "1", { shift: true, code: "Digit1" })) {
    return "heading1"
  }

  if (matches(event, "2", { shift: true, code: "Digit2" })) {
    return "heading2"
  }

  if (matches(event, "3", { shift: true, code: "Digit3" })) {
    return "heading3"
  }

  if (matches(event, "5", { shift: true, code: "Digit5" })) {
    return "blockquote"
  }

  if (matches(event, "6", { shift: true, code: "Digit6" })) {
    return "bulletList"
  }

  if (matches(event, "7", { shift: true, code: "Digit7" })) {
    return "orderedList"
  }

  if (matches(event, "8", { shift: true, code: "Digit8" })) {
    return "table"
  }

  if (matches(event, "f", { shift: true, code: "KeyF" })) {
    return "focusMode"
  }

  if (matches(event, "y", { shift: true, code: "KeyY" })) {
    return "newWriting"
  }

  if (matches(event, "<", { shift: true, code: "Comma" })) {
    return "settings"
  }

  return null
}

export const getEditorShortcutLabel = (action: EditorShortcutAction): string | null => {
  return getShortcutForPlatform(EDITOR_SHORTCUT_LABELS[action])
}
