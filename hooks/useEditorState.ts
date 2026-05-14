"use client"

import type { Editor } from "@tiptap/react"
import { useEditorState } from "@tiptap/react"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"

export type TopbarTrackedAction = Extract<
  EditorShortcutAction,
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "link"
  | "blockquote"
  | "codeBlock"
  | "bulletList"
  | "orderedList"
  | "inlineCode"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "table"
  | "image"
>

type StructureAction = "paragraph" | "heading1" | "heading2" | "heading3"
type SelectedStructure = StructureAction | "other"

const DEFAULT_EDITOR_ACTION_STATE: Readonly<Record<TopbarTrackedAction, boolean>> = {
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  link: false,
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  inlineCode: false,
  paragraph: false,
  heading1: false,
  heading2: false,
  heading3: false,
  table: false,
  image: false,
}

export const resolveStructureState = (editor: Editor): StructureAction | null => {
  const { selection, doc } = editor.state

  if (selection.empty) {
    if (editor.isActive("heading", { level: 1 })) {
      return "heading1"
    }

    if (editor.isActive("heading", { level: 2 })) {
      return "heading2"
    }

    if (editor.isActive("heading", { level: 3 })) {
      return "heading3"
    }

    if (editor.isActive("paragraph")) {
      return "paragraph"
    }

    return null
  }

  const selectedStructures = new Set<SelectedStructure>()

  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isTextblock) {
      return true
    }

    if (node.type.name === "paragraph") {
      selectedStructures.add("paragraph")
      return false
    }

    if (node.type.name === "heading") {
      const headingLevel = Number(node.attrs.level)

      if (headingLevel === 1 || headingLevel === 2 || headingLevel === 3) {
        selectedStructures.add(`heading${headingLevel}` as StructureAction)
      } else {
        selectedStructures.add("other")
      }

      return false
    }

    selectedStructures.add("other")
    return false
  })

  if (selectedStructures.size !== 1) {
    return null
  }

  const [selectedStructure] = selectedStructures

  if (
    selectedStructure === "paragraph" ||
    selectedStructure === "heading1" ||
    selectedStructure === "heading2" ||
    selectedStructure === "heading3"
  ) {
    return selectedStructure
  }

  return null
}

export const resolveEditorActionState = (editor: Editor): Readonly<Record<TopbarTrackedAction, boolean>> => {
  const selectedStructure = resolveStructureState(editor)

  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    highlight: editor.isActive("highlight"),
    link: editor.isActive("link"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    inlineCode: editor.isActive("code"),
    paragraph: selectedStructure === "paragraph",
    heading1: selectedStructure === "heading1",
    heading2: selectedStructure === "heading2",
    heading3: selectedStructure === "heading3",
    table: editor.isActive("table"),
    image: false,
  }
}

export const useEditorActionState = (editor: Editor | null): Readonly<Record<TopbarTrackedAction, boolean>> => {
  const actionState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return DEFAULT_EDITOR_ACTION_STATE
      }

      return resolveEditorActionState(currentEditor)
    },
  })

  return actionState ?? DEFAULT_EDITOR_ACTION_STATE
}
