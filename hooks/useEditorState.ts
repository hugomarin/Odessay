"use client"

import type { Editor } from "@tiptap/react"
import { useEditorState } from "@tiptap/react"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"

type TopbarTrackedAction = Extract<
  EditorShortcutAction,
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "link"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "inlineCode"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "table"
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
  bulletList: false,
  orderedList: false,
  inlineCode: false,
  paragraph: false,
  heading1: false,
  heading2: false,
  heading3: false,
  table: false,
}

const resolveStructureState = (editor: Editor): StructureAction | null => {
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

export const useEditorActionState = (editor: Editor | null): Readonly<Record<TopbarTrackedAction, boolean>> => {
  const actionState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return DEFAULT_EDITOR_ACTION_STATE
      }

      const selectedStructure = resolveStructureState(currentEditor)

      return {
        bold: currentEditor.isActive("bold"),
        italic: currentEditor.isActive("italic"),
        strike: currentEditor.isActive("strike"),
        highlight: currentEditor.isActive("highlight"),
        link: currentEditor.isActive("link"),
        blockquote: currentEditor.isActive("blockquote"),
        bulletList: currentEditor.isActive("bulletList"),
        orderedList: currentEditor.isActive("orderedList"),
        inlineCode: currentEditor.isActive("code"),
        paragraph: selectedStructure === "paragraph",
        heading1: selectedStructure === "heading1",
        heading2: selectedStructure === "heading2",
        heading3: selectedStructure === "heading3",
        table: false,
      }
    },
  })

  return actionState ?? DEFAULT_EDITOR_ACTION_STATE
}

