import { getShortcutForPlatform, isMacPlatform, type ShortcutDisplay } from "@/lib/keyboard-shortcuts"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"

export type EditorShortcutAction =
  // Format (inline marks)
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "inlineCode"
  | "codeBlock"
  | "link"
  // Structure (blocks)
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  // Insert
  | "footnote"
  | "table"
  | "image"
  | "horizontalRule"
  // Navigate (global)
  | "goDesk"
  | "goWorkspace"
  | "goStudio"
  | "search"
  | "nextTab"
  | "prevTab"
  // Annotate / Voice / Document
  | "addNote"
  | "voiceNote"
  | "documentProperties"
  | "corrections"
  // Editor / View
  | "find"
  | "replace"
  | "focusMode"
  | "toggleSidebar"
  | "shortcutHelp"
  | "newWriting"
  | "settings"
  // Menu-only actions (no keyboard shortcut)
  | "clearStyles"
  | "copyAsMarkdown"
  | "copyAsHtml"
  | "date"
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
  // Format
  bold: { mac: "⌘B", windows: "Ctrl+B" },
  italic: { mac: "⌘I", windows: "Ctrl+I" },
  strike: { mac: "⌘⇧X", windows: "Ctrl+Shift+X" },
  highlight: { mac: "⌘⇧H", windows: "Ctrl+Shift+H" },
  inlineCode: { mac: "⌘E", windows: "Ctrl+E" },
  codeBlock: { mac: "⌘⇧E", windows: "Ctrl+Shift+E" },
  link: { mac: "⌘⇧K", windows: "Ctrl+Shift+K" },
  // Structure
  paragraph: { mac: "⌘0", windows: "Ctrl+0" },
  heading1: { mac: "⌘1", windows: "Ctrl+1" },
  heading2: { mac: "⌘2", windows: "Ctrl+2" },
  heading3: { mac: "⌘3", windows: "Ctrl+3" },
  bulletList: { mac: "⌘L", windows: "Ctrl+L" },
  orderedList: { mac: "⌘⇧L", windows: "Ctrl+Shift+L" },
  blockquote: { mac: "⌘⇧B", windows: "Ctrl+Shift+B" },
  // Insert
  footnote: { mac: "⌘⇧A", windows: "Ctrl+Shift+A" },
  table: { mac: "⌘T", windows: "Ctrl+T" },
  image: { mac: "⌘⇧I", windows: "Ctrl+Shift+I" },
  horizontalRule: { mac: "⌘⇧-", windows: "Ctrl+Shift+-" },
  // Navigate
  goDesk: { mac: "⌘⌥1", windows: "Ctrl+Alt+1" },
  goWorkspace: { mac: "⌘⌥2", windows: "Ctrl+Alt+2" },
  goStudio: { mac: "⌘⌥3", windows: "Ctrl+Alt+3" },
  search: { mac: "⌘K", windows: "Ctrl+K" },
  nextTab: { mac: "⌘⇧]", windows: "Ctrl+Shift+]" },
  prevTab: { mac: "⌘⇧[", windows: "Ctrl+Shift+[" },
  // Annotate / Voice / Document
  addNote: { mac: "⌘⇧N", windows: "Ctrl+Shift+N" },
  voiceNote: { mac: "⌘⌥R", windows: "Ctrl+Alt+R" },
  documentProperties: { mac: "⌘⌥P", windows: "Ctrl+Alt+P" },
  corrections: { mac: "⌘⌥S", windows: "Ctrl+Alt+S" },
  // Editor / View
  find: { mac: "⌘F", windows: "Ctrl+F" },
  replace: { mac: "⌘⌥F", windows: "Ctrl+Alt+F" },
  focusMode: { mac: "⌘⇧F", windows: "Ctrl+Shift+F" },
  toggleSidebar: { mac: "⌘\\", windows: "Ctrl+\\" },
  shortcutHelp: { mac: "⌘/", windows: "Ctrl+/" },
  newWriting: { mac: "⌘N", windows: "Ctrl+N" },
  settings: { mac: "⌘,", windows: "Ctrl+," },
  // Menu-only (no keyboard shortcut)
  clearStyles: { mac: "", windows: "" },
  copyAsMarkdown: { mac: "", windows: "" },
  copyAsHtml: { mac: "", windows: "" },
  date: { mac: "", windows: "" },
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

  // Code fallback is essential for Alt (⌥) combos on macOS, where the produced
  // `key` is an alternate glyph (e.g. ⌥1 → "¡", ⌥r → "®") but `code` is stable.
  return event.code === code
}

const matches = (event: KeyboardLikeEvent, key: string, options: { shift?: boolean; alt?: boolean; code?: string } = {}) =>
  matchesKey(event, key, options.code) && isCommandKey(event) && hasNoExtraModifiers(event, options)

export const getEditorShortcutAction = (event: KeyboardLikeEvent): EditorShortcutAction | null => {
  // --- Navigate (global) ---
  if (matches(event, "1", { alt: true, code: "Digit1" })) {
    return "goDesk"
  }

  if (matches(event, "2", { alt: true, code: "Digit2" })) {
    return "goWorkspace"
  }

  if (matches(event, "3", { alt: true, code: "Digit3" })) {
    return "goStudio"
  }

  if (matches(event, "k", { code: "KeyK" })) {
    return "search"
  }

  if (matches(event, "]", { shift: true, code: "BracketRight" })) {
    return "nextTab"
  }

  if (matches(event, "[", { shift: true, code: "BracketLeft" })) {
    return "prevTab"
  }

  // --- Format (inline marks) ---
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

  if (matches(event, "e", { shift: true, code: "KeyE" })) {
    return "codeBlock"
  }

  if (matches(event, "e", { code: "KeyE" })) {
    return "inlineCode"
  }

  if (matches(event, "k", { shift: true, code: "KeyK" })) {
    return "link"
  }

  // --- Structure (blocks) ---
  if (matches(event, "0", { code: "Digit0" })) {
    return "paragraph"
  }

  if (matches(event, "1", { code: "Digit1" })) {
    return "heading1"
  }

  if (matches(event, "2", { code: "Digit2" })) {
    return "heading2"
  }

  if (matches(event, "3", { code: "Digit3" })) {
    return "heading3"
  }

  if (matches(event, "l", { shift: true, code: "KeyL" })) {
    return "orderedList"
  }

  if (matches(event, "l", { code: "KeyL" })) {
    return "bulletList"
  }

  if (matches(event, "b", { shift: true, code: "KeyB" })) {
    return "blockquote"
  }

  // --- Insert ---
  if (matches(event, "a", { shift: true, code: "KeyA" })) {
    return "footnote"
  }

  if (matches(event, "t", { code: "KeyT" })) {
    return "table"
  }

  if (matches(event, "i", { shift: true, code: "KeyI" })) {
    return "image"
  }

  if (matches(event, "-", { shift: true, code: "Minus" })) {
    return "horizontalRule"
  }

  // --- Annotate / Voice / Document ---
  if (matches(event, "n", { shift: true, code: "KeyN" })) {
    return "addNote"
  }

  if (matches(event, "r", { alt: true, code: "KeyR" })) {
    return "voiceNote"
  }

  if (matches(event, "p", { alt: true, code: "KeyP" })) {
    return "documentProperties"
  }

  if (matches(event, "s", { alt: true, code: "KeyS" })) {
    return "corrections"
  }

  // --- Editor / View ---
  if (matches(event, "f", { code: "KeyF" })) {
    return "find"
  }

  if (matches(event, "f", { alt: true, code: "KeyF" })) {
    return "replace"
  }

  if (matches(event, "f", { shift: true, code: "KeyF" })) {
    return "focusMode"
  }

  if (matches(event, "\\", { code: "Backslash" })) {
    return "toggleSidebar"
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

// Availability reflects where a shortcut actually fires. Several single-modifier
// keys (⌘0–3, ⌘L, ⌘T, ⌘⇧]/[, ⌘⇧A, ⌘⇧B, ⌘⇧I, ⌘⇧N) are intercepted by the browser
// in web (tab switching, address bar, reopen tab, etc.) but are free in the
// desktop shell, which is the primary target — those are marked "desktop".
export const EDITOR_SHORTCUT_HELP_SECTIONS: ShortcutHelpSection[] = [
  {
    title: "Navigate",
    items: [
      { action: "goDesk", availability: "both", description: "Go to Desk" },
      { action: "goWorkspace", availability: "both", description: "Go to Workspace" },
      { action: "goStudio", availability: "both", description: "Go to Studio (soon)" },
      { action: "search", availability: "both", description: "Search" },
      { action: "nextTab", availability: "desktop", description: "Next tab" },
      { action: "prevTab", availability: "desktop", description: "Previous tab" },
      { action: "newWriting", availability: "desktop", description: "New writing tab" },
    ],
  },
  {
    title: "Format",
    items: [
      { action: "bold", availability: "both", description: "Bold" },
      { action: "italic", availability: "both", description: "Italic" },
      { action: "strike", availability: "both", description: "Strikethrough" },
      { action: "highlight", availability: "both", description: "Highlight" },
      { action: "inlineCode", availability: "both", description: "Inline code" },
      { action: "codeBlock", availability: "both", description: "Code block" },
      { action: "link", availability: "both", description: "Insert link" },
    ],
  },
  {
    title: "Structure",
    items: [
      { action: "paragraph", availability: "desktop", description: "Paragraph" },
      { action: "heading1", availability: "desktop", description: "Heading 1" },
      { action: "heading2", availability: "desktop", description: "Heading 2" },
      { action: "heading3", availability: "desktop", description: "Heading 3" },
      { action: "bulletList", availability: "desktop", description: "Bulleted list" },
      { action: "orderedList", availability: "both", description: "Numbered list" },
      { action: "blockquote", availability: "desktop", description: "Blockquote" },
    ],
  },
  {
    title: "Insert",
    items: [
      { action: "footnote", availability: "desktop", description: "Footnote" },
      { action: "table", availability: "desktop", description: "Table" },
      { action: "image", availability: "desktop", description: "Image" },
      { action: "horizontalRule", availability: "both", description: "Horizontal rule" },
    ],
  },
  {
    title: "Annotate & Document",
    items: [
      { action: "addNote", availability: "desktop", description: "Add note" },
      { action: "voiceNote", availability: "both", description: "Voice note (start / stop)" },
      { action: "documentProperties", availability: "both", description: "Document properties" },
      { action: "corrections", availability: "both", description: "Corrections" },
    ],
  },
  {
    title: "Editor",
    items: [
      { action: "find", availability: "both", description: "Find" },
      { action: "replace", availability: "both", description: "Replace" },
      { action: "focusMode", availability: "both", description: "Toggle focus mode" },
      { action: "toggleSidebar", availability: "both", description: "Toggle sidebar" },
      { action: "shortcutHelp", availability: "both", description: "Open shortcut help" },
      { action: "settings", availability: "both", description: "Open settings" },
    ],
  },
]
