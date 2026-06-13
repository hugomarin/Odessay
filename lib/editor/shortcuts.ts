import { getShortcutForPlatform, isMacPlatform, type ShortcutDisplay } from "@/lib/keyboard-shortcuts"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

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
  | "shortcutHelp"
  | "newWriting"
  | "settings"
  | "table"
  | "image"
  | "find"
  | "replace"
  | "clearStyles"
  | "horizontalRule"
  | "copyAsMarkdown"
  | "copyAsHtml"
  | "date"
  | "toggleSidebar"
  | "toggleTopbar"
  | "toggleTabBar"

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
  shortcutHelp: { mac: "⌘/", windows: "Ctrl+/" },
  newWriting: { mac: "⌘N", windows: "Ctrl+N" },
  settings: { mac: "⌘,", windows: "Ctrl+," },
  table: { mac: "⌘⇧T", windows: "Ctrl+Shift+T" },
  image: { mac: "⌘⇧I", windows: "Ctrl+Shift+I" },
  find: { mac: "⌘F", windows: "Ctrl+F" },
  replace: { mac: "⌘⌥F", windows: "Ctrl+Alt+F" },
  clearStyles: { mac: "", windows: "" },
  horizontalRule: { mac: "⌘⇧-", windows: "Ctrl+Shift+-" },
  copyAsMarkdown: { mac: "", windows: "" },
  copyAsHtml: { mac: "", windows: "" },
  date: { mac: "", windows: "" },
  toggleSidebar: { mac: "", windows: "" },
  toggleTopbar: { mac: "", windows: "" },
  toggleTabBar: { mac: "", windows: "" },
}

const isCommandKey = (event: KeyboardLikeEvent) =>
  isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey

const hasNoExtraModifiers = (event: KeyboardLikeEvent, options: { shift?: boolean; alt?: boolean } = {}) =>
  event.shiftKey === (options.shift ?? false) && event.altKey === (options.alt ?? false)

const matchesKey = (event: KeyboardLikeEvent, key: string, code?: string) => {
  if (event.key.toLowerCase() === key) {
    return true
  }

  if (!code || !event.code) {
    return false
  }

  return event.code === code
}

const matches = (event: KeyboardLikeEvent, key: string, options: { shift?: boolean; alt?: boolean; code?: string } = {}) =>
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

  if (matches(event, "i", { shift: true, code: "KeyI" })) {
    return "image"
  }

  if (matches(event, "f", { code: "KeyF" })) {
    return "find"
  }

  if (matches(event, "f", { alt: true, code: "KeyF" })) {
    return "replace"
  }

  if (matches(event, "f", { shift: true, code: "KeyF" })) {
    return "focusMode"
  }

  if (matches(event, "/", { code: "Slash" })) {
    return "shortcutHelp"
  }

  if (isDesktopRuntime() && matches(event, "n", { code: "KeyN" })) {
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

export type ShortcutHelpItem = {
  action: EditorShortcutAction
  availability: "both" | "desktop" | "web"
  description: string
}

export type ShortcutHelpSection = {
  title: string
  items: ShortcutHelpItem[]
}

export const EDITOR_SHORTCUT_HELP_SECTIONS: ShortcutHelpSection[] = [
  {
    title: "Format",
    items: [
      { action: "bold", availability: "both", description: "Bold selection" },
      { action: "italic", availability: "both", description: "Italic selection" },
      { action: "strike", availability: "both", description: "Strike through text" },
      { action: "highlight", availability: "both", description: "Highlight selection" },
      { action: "inlineCode", availability: "both", description: "Inline code" },
      { action: "codeBlock", availability: "both", description: "Code block" },
      { action: "link", availability: "both", description: "Insert link" },
    ],
  },
  {
    title: "Structure",
    items: [
      { action: "paragraph", availability: "both", description: "Body paragraph" },
      { action: "heading1", availability: "both", description: "Heading 1" },
      { action: "heading2", availability: "both", description: "Heading 2" },
      { action: "heading3", availability: "both", description: "Heading 3" },
      { action: "blockquote", availability: "both", description: "Blockquote" },
      { action: "bulletList", availability: "both", description: "Bulleted list" },
      { action: "orderedList", availability: "both", description: "Numbered list" },
    ],
  },
  {
    title: "Editor",
    items: [
      { action: "find", availability: "both", description: "Find in current writing" },
      { action: "replace", availability: "both", description: "Replace in current writing" },
      { action: "focusMode", availability: "both", description: "Toggle focus mode" },
      { action: "shortcutHelp", availability: "both", description: "Open shortcut help" },
      { action: "newWriting", availability: "desktop", description: "Create a new writing tab" },
      { action: "settings", availability: "both", description: "Open settings" },
    ],
  },
]
