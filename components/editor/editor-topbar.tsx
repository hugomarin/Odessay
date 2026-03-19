"use client"

import type { ComponentType } from "react"
import type { Editor } from "@tiptap/react"
import {
  AlignLeft,
  Bold,
  Code2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Quote,
  SlidersHorizontal,
  Strikethrough,
  Subscript,
} from "lucide-react"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"
import { cn } from "@/lib/utils"

type EditorTopbarProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  title: string
  isFocusMode: boolean
  activePanel: "notes" | "properties" | null
  onToggleMode: (mode: "rich" | "markdown") => void
  onToggleFocusMode: () => void
  onTogglePanel: (panel: "notes" | "properties") => void
  onOpenRenameModal: () => void
  onRunAction: (action: EditorShortcutAction) => void
}

type TopbarActionItem = {
  id: string
  label: string
  action: EditorShortcutAction
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}

type StructureActionItem = {
  id: string
  label: string
  action: EditorShortcutAction
  text: string
}

const FORMAT_ACTIONS: TopbarActionItem[] = [
  { id: "editor-action-bold", label: "Bold", action: "bold", icon: Bold },
  { id: "editor-action-italic", label: "Italic", action: "italic", icon: Italic },
  { id: "editor-action-strike", label: "Strike", action: "strike", icon: Strikethrough },
  { id: "editor-action-highlight", label: "Highlight", action: "highlight", icon: Highlighter },
  { id: "editor-action-link", label: "Link", action: "link", icon: Link2 },
  { id: "editor-action-footnote", label: "Footnote", action: "footnote", icon: Subscript },
  { id: "editor-action-blockquote", label: "Quote", action: "blockquote", icon: Quote },
  { id: "editor-action-bullet-list", label: "Bullet list", action: "bulletList", icon: List },
  {
    id: "editor-action-ordered-list",
    label: "Numbered list",
    action: "orderedList",
    icon: ListOrdered,
  },
  { id: "editor-action-inline-code", label: "Inline code", action: "inlineCode", icon: Code2 },
]

const STRUCTURE_ACTIONS: StructureActionItem[] = [
  { id: "editor-action-paragraph", label: "Paragraph", action: "paragraph", text: "¶" },
  { id: "editor-action-heading-1", label: "Heading 1", action: "heading1", text: "H1" },
  { id: "editor-action-heading-2", label: "Heading 2", action: "heading2", text: "H2" },
  { id: "editor-action-heading-3", label: "Heading 3", action: "heading3", text: "H3" },
]

const isActionActive = (editor: Editor | null, action: EditorShortcutAction) => {
  if (!editor) {
    return false
  }

  switch (action) {
    case "bold":
      return editor.isActive("bold")
    case "italic":
      return editor.isActive("italic")
    case "strike":
      return editor.isActive("strike")
    case "highlight":
      return editor.isActive("highlight")
    case "link":
      return editor.isActive("link")
    case "blockquote":
      return editor.isActive("blockquote")
    case "bulletList":
      return editor.isActive("bulletList")
    case "orderedList":
      return editor.isActive("orderedList")
    case "inlineCode":
      return editor.isActive("code")
    case "paragraph":
      return editor.isActive("paragraph")
    case "heading1":
      return editor.isActive("heading", { level: 1 })
    case "heading2":
      return editor.isActive("heading", { level: 2 })
    case "heading3":
      return editor.isActive("heading", { level: 3 })
    default:
      return false
  }
}

export function EditorTopbar({
  editor,
  mode,
  title,
  isFocusMode,
  activePanel,
  onToggleMode,
  onToggleFocusMode,
  onTogglePanel,
  onOpenRenameModal,
  onRunAction,
}: EditorTopbarProps) {
  const disableFormatting = mode === "markdown"

  return (
    <div
      id="editor-topbar"
      data-section="editor-topbar"
      data-testid="editor-topbar"
      className="EditorTopbar sticky top-0 z-20 flex h-[46px] items-center justify-between border-b-[0.5px] border-border bg-bg/95 px-3 backdrop-blur"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="inline-flex h-8 items-center rounded-md border-[0.5px] border-border bg-sb p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => onToggleMode("rich")}
            className={cn(
              "h-7 rounded-[6px] px-2.5 font-medium transition-colors",
              mode === "rich" ? "bg-ink text-bg" : "text-ink-3 hover:bg-muted hover:text-ink",
            )}
          >
            Rich
          </button>
          <button
            type="button"
            onClick={() => onToggleMode("markdown")}
            className={cn(
              "h-7 rounded-[6px] px-2.5 font-medium transition-colors",
              mode === "markdown" ? "bg-ink text-bg" : "text-ink-3 hover:bg-muted hover:text-ink",
            )}
          >
            Markdown
          </button>
        </div>

        <div
          className={cn(
            "flex items-center gap-1 rounded-md border-[0.5px] border-border bg-sb px-1 py-1 transition-opacity",
            disableFormatting && "pointer-events-none opacity-35",
          )}
          aria-disabled={disableFormatting}
        >
          {FORMAT_ACTIONS.map((actionItem) => (
            <button
              key={actionItem.id}
              id={actionItem.id}
              type="button"
              onClick={() => onRunAction(actionItem.action)}
              title={actionItem.label}
              aria-label={actionItem.label}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors",
                isActionActive(editor, actionItem.action)
                  ? "bg-muted text-ink"
                  : "hover:bg-muted hover:text-ink",
              )}
            >
              <actionItem.icon className="h-[13px] w-[13px]" strokeWidth={1.5} />
            </button>
          ))}

          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

          {STRUCTURE_ACTIONS.map((actionItem) => (
            <button
              key={actionItem.id}
              id={actionItem.id}
              type="button"
              onClick={() => onRunAction(actionItem.action)}
              title={actionItem.label}
              aria-label={actionItem.label}
              className={cn(
                "inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] px-1 text-[11px] font-medium transition-colors",
                isActionActive(editor, actionItem.action)
                  ? "bg-muted text-ink"
                  : "text-ink-3 hover:bg-muted hover:text-ink",
              )}
            >
              {actionItem.text}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-6 min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpenRenameModal}
          className="mx-auto block max-w-[460px] truncate px-3 text-center font-lora text-[15px] text-ink-2 transition-colors hover:text-ink"
          title={title}
        >
          {title}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleFocusMode}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border-[0.5px] border-border bg-sb text-ink-3 transition-colors hover:bg-muted hover:text-ink"
          title={isFocusMode ? "Exit focus mode" : "Focus mode"}
          aria-label={isFocusMode ? "Exit focus mode" : "Focus mode"}
        >
          {isFocusMode ? (
            <Minimize2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
          ) : (
            <Maximize2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
          )}
        </button>

        <button
          type="button"
          onClick={() => onTogglePanel("notes")}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border-[0.5px] border-border bg-sb text-ink-3 transition-colors hover:bg-muted hover:text-ink",
            activePanel === "notes" && "bg-muted text-ink",
          )}
          title="Notes panel"
          aria-label="Notes panel"
          aria-pressed={activePanel === "notes"}
        >
          <AlignLeft className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>

        <button
          type="button"
          onClick={() => onTogglePanel("properties")}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border-[0.5px] border-border bg-sb text-ink-3 transition-colors hover:bg-muted hover:text-ink",
            activePanel === "properties" && "bg-muted text-ink",
          )}
          title="Properties panel"
          aria-label="Properties panel"
          aria-pressed={activePanel === "properties"}
        >
          <SlidersHorizontal className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
