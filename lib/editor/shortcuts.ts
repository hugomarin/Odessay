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
  bold: { mac: "⌘B", windows: "Ctrl+B" },
  italic: { mac: "⌘I", windows: "Ctrl+I" },
  strike: { mac: "⌘⇧X", windows: "Ctrl+Shift+X" },
  highlight: { mac: "⌘⇧H", windows: "Ctrl+Shift+H" },
  inlineCode: { mac: "⌘⇧C", windows: "Ctrl+Shift+C" },
  codeBlock: { mac: "⌘⇧D", windows: "Ctrl+Shift+D" },
  link: { mac: "⌘K", windows: "Ctrl+K" },
  footnote: { mac: "⌘⇧A", windows: "Ctrl+Shift+A" },
  paragraph: { mac: "⌘⇧0", windows: "Ctrl+Shift+0" },
  heading1: { mac: "⌘⇧1", windows: "Ctrl+Shift+1" },
  heading2: { mac: "⌘⇧2", windows: "Ctrl+Shift+2" },
  heading3: { mac: "⌘⇧9", windows: "Ctrl+Shift+9" },
  blockquote: { mac: "⌘⇧6", windows: "Ctrl+Shift+6" },
  bulletList: { mac: "⌘⇧L", windows: "Ctrl+Shift+L" },
  orderedList: { mac: "⌘⇧O", windows: "Ctrl+Shift+O" },
  focusMode: { mac: "⌘⇧F", windows: "Ctrl+Shift+F" },
  newWriting: { mac: "⌘⇧N", windows: "Ctrl+Shift+N" },
  settings: { mac: "⌘,", windows: "Ctrl+," },
  table: { mac: "⌘⇧T", windows: "Ctrl+Shift+T" },
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
  if (matches(event, "b", { code: "KeyB" })) {
    return "bold"
  }

  if (matches(event, "i", { code: "KeyI" })) {
    return "italic"
  }

  if (matches(event, "x", { shift: true, code: "KeyX" })) {
    return "strike"
  }

  if (matches(event, "h", { shift: true, code: "KeyH" })) {
    return "highlight"
  }

  if (matches(event, "c", { shift: true, code: "KeyC" })) {
    return "inlineCode"
  }

  if (matches(event, "d", { shift: true, code: "KeyD" })) {
    return "codeBlock"
  }

  if (matches(event, "k", { code: "KeyK" })) {
    return "link"
  }

  if (matches(event, "a", { shift: true, code: "KeyA" })) {
    return "footnote"
  }

  if (matches(event, "0", { shift: true, code: "Digit0" })) {
    return "paragraph"
  }

  if (matches(event, "1", { shift: true, code: "Digit1" })) {
    return "heading1"
  }

  if (matches(event, "2", { shift: true, code: "Digit2" })) {
    return "heading2"
  }

  if (matches(event, "9", { shift: true, code: "Digit9" })) {
    return "heading3"
  }

  if (matches(event, "6", { shift: true, code: "Digit6" })) {
    return "blockquote"
  }

  if (matches(event, "l", { shift: true, code: "KeyL" })) {
    return "bulletList"
  }

  if (matches(event, "o", { shift: true, code: "KeyO" })) {
    return "orderedList"
  }

  if (matches(event, "t", { shift: true, code: "KeyT" })) {
    return "table"
  }

  if (matches(event, "f", { shift: true, code: "KeyF" })) {
    return "focusMode"
  }

  if (matches(event, "n", { shift: true, code: "KeyN" })) {
    return "newWriting"
  }

  if (matches(event, ",", { code: "Comma" })) {
    return "settings"
  }

  return null
}

export const getEditorShortcutLabel = (action: EditorShortcutAction): string | null => {
  return getShortcutForPlatform(EDITOR_SHORTCUT_LABELS[action])
}
