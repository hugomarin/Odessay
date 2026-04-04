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
  | "table"

export type KeyboardLikeEvent = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const EDITOR_SHORTCUT_LABELS: Partial<Record<EditorShortcutAction, ShortcutDisplay>> = {
  bold: { mac: "⌘B", windows: "Ctrl+B" },
  italic: { mac: "⌘I", windows: "Ctrl+I" },
  strike: { mac: "⌘⌥U", windows: "Ctrl+Alt+U" },
  highlight: { mac: "⌘⇧U", windows: "Ctrl+Shift+U" },
  inlineCode: { mac: "⌘J", windows: "Ctrl+J" },
  codeBlock: { mac: "⌘⇧J", windows: "Ctrl+Shift+J" },
  link: { mac: "⌘K", windows: "Ctrl+K" },
  footnote: { mac: "⌃⌘K", windows: "Ctrl+Alt+K" },
  paragraph: { mac: "⌘⌥P", windows: "Ctrl+Alt+P" },
  heading1: { mac: "⌘⌥1", windows: "Ctrl+Alt+1" },
  heading2: { mac: "⌘⌥2", windows: "Ctrl+Alt+2" },
  heading3: { mac: "⌘⌥3", windows: "Ctrl+Alt+3" },
  blockquote: { mac: "⌘⌥Q", windows: "Ctrl+Alt+Q" },
  bulletList: { mac: "⌘⇧8", windows: "Ctrl+Shift+8" },
  orderedList: { mac: "⌘⇧7", windows: "Ctrl+Shift+7" },
  focusMode: { mac: "⌘⇧F", windows: "Ctrl+Shift+F" },
  table: { mac: "⌘⇧T", windows: "Ctrl+Shift+T" },
}

const isCommandKey = (event: KeyboardLikeEvent) =>
  isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey

const hasNoExtraModifiers = (
  event: KeyboardLikeEvent,
  options: { shift?: boolean; alt?: boolean } = {},
) => {
  const expectedShift = options.shift ?? false
  const expectedAlt = options.alt ?? false

  return event.shiftKey === expectedShift && event.altKey === expectedAlt
}

const matchesKey = (event: KeyboardLikeEvent, key: string, code?: string) => {
  if (event.key.toLowerCase() === key) {
    return true
  }

  if (!code || !event.code) {
    return false
  }

  return event.code === code
}

const matches = (
  event: KeyboardLikeEvent,
  key: string,
  options: { shift?: boolean; alt?: boolean; code?: string } = {},
) => matchesKey(event, key, options.code) && isCommandKey(event) && hasNoExtraModifiers(event, options)

const isFootnoteShortcut = (event: KeyboardLikeEvent) => {
  if (!matchesKey(event, "k", "KeyK")) {
    return false
  }

  if (isMacPlatform()) {
    return event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey
  }

  return event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey
}

export const getEditorShortcutAction = (event: KeyboardLikeEvent): EditorShortcutAction | null => {
  if (matches(event, "q", { alt: true, code: "KeyQ" })) {
    return "blockquote"
  }

  if (matches(event, "b")) {
    return "bold"
  }

  if (matches(event, "i")) {
    return "italic"
  }

  if (matches(event, "u", { alt: true })) {
    return "strike"
  }

  if (matches(event, "u", { shift: true })) {
    return "highlight"
  }

  if (matches(event, "j")) {
    return "inlineCode"
  }

  if (matches(event, "j", { shift: true })) {
    return "codeBlock"
  }

  if (matches(event, "k")) {
    return "link"
  }

  if (isFootnoteShortcut(event)) {
    return "footnote"
  }

  if (matches(event, "p", { alt: true, code: "KeyP" })) {
    return "paragraph"
  }

  if (matches(event, "1", { alt: true, code: "Digit1" })) {
    return "heading1"
  }

  if (matches(event, "2", { alt: true, code: "Digit2" })) {
    return "heading2"
  }

  if (matches(event, "3", { alt: true, code: "Digit3" })) {
    return "heading3"
  }

  if (matches(event, "8", { shift: true })) {
    return "bulletList"
  }

  if (matches(event, "7", { shift: true })) {
    return "orderedList"
  }

  if (matches(event, "f", { shift: true })) {
    return "focusMode"
  }

  if (matches(event, "t", { shift: true })) {
    return "table"
  }

  return null
}

export const getEditorShortcutLabel = (action: EditorShortcutAction): string | null => {
  const shortcut = EDITOR_SHORTCUT_LABELS[action]

  if (!shortcut) {
    return null
  }

  return getShortcutForPlatform(shortcut)
}
