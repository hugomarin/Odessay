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
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const isMacPlatform = () => {
  if (typeof navigator === "undefined") {
    return true
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
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

const matches = (
  event: KeyboardLikeEvent,
  key: string,
  options: { shift?: boolean; alt?: boolean } = {},
) => event.key.toLowerCase() === key && isCommandKey(event) && hasNoExtraModifiers(event, options)

const isFootnoteShortcut = (event: KeyboardLikeEvent) => {
  if (event.key.toLowerCase() !== "k") {
    return false
  }

  if (isMacPlatform()) {
    return event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey
  }

  return event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey
}

export const getEditorShortcutAction = (event: KeyboardLikeEvent): EditorShortcutAction | null => {
  if (matches(event, "b", { shift: true })) {
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

  if (matches(event, "0", { alt: true })) {
    return "paragraph"
  }

  if (matches(event, "1", { alt: true })) {
    return "heading1"
  }

  if (matches(event, "2", { alt: true })) {
    return "heading2"
  }

  if (matches(event, "3", { alt: true })) {
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
