"use client"

import type { ComponentType } from "react"
import type { Editor } from "@tiptap/react"
import {
  AlignLeft,
  Bold,
  Code2,
  Expand,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minimize2,
  SlidersHorizontal,
  Strikethrough,
  Superscript,
  Table,
} from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutLabel, type EditorShortcutAction } from "@/lib/editor/shortcuts"
import { cn } from "@/lib/utils"

type EditorTopbarProps = {
  editor: Editor | null
  title: string
  isFocusMode: boolean
  activePanel: "notes" | "properties" | null
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
  { id: "editor-action-link", label: "Link", action: "link", icon: Link },
  { id: "editor-action-footnote", label: "Footnote", action: "footnote", icon: Superscript },
  { id: "editor-action-blockquote", label: "Quote", action: "blockquote", icon: MessageSquareQuote },
  { id: "editor-action-bullet-list", label: "Bullet list", action: "bulletList", icon: List },
  {
    id: "editor-action-ordered-list",
    label: "Numbered list",
    action: "orderedList",
    icon: ListOrdered,
  },
  { id: "editor-action-inline-code", label: "Inline code", action: "inlineCode", icon: Code2 },
  { id: "editor-action-table", label: "Table", action: "table", icon: Table },
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
  title,
  isFocusMode,
  activePanel,
  onToggleFocusMode,
  onTogglePanel,
  onOpenRenameModal,
  onRunAction,
}: EditorTopbarProps) {
  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="editor-topbar"
        data-section="editor-topbar"
        data-testid="editor-topbar"
        className="EditorTopbar sticky top-0 z-20 flex h-[46px] items-center justify-between border-b-[0.5px] border-border bg-bg px-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex items-center gap-0.5 px-1 transition-opacity"
            aria-disabled={false}
          >
            {FORMAT_ACTIONS.map((actionItem) => (
              <ActionTooltip
                key={actionItem.id}
                label={actionItem.label}
                shortcut={getEditorShortcutLabel(actionItem.action)}
                side="bottom"
              >
                <button
                  id={actionItem.id}
                  type="button"
                  onClick={() => onRunAction(actionItem.action)}
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
              </ActionTooltip>
            ))}

            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

            {STRUCTURE_ACTIONS.map((actionItem) => (
              <ActionTooltip
                key={actionItem.id}
                label={actionItem.label}
                shortcut={getEditorShortcutLabel(actionItem.action)}
                side="bottom"
              >
                <button
                  id={actionItem.id}
                  type="button"
                  onClick={() => onRunAction(actionItem.action)}
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
              </ActionTooltip>
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <button
            type="button"
            onClick={onOpenRenameModal}
            className="pointer-events-auto max-w-[460px] truncate px-3 text-center font-lora text-[13px] text-ink-3 transition-colors hover:text-ink"
            title={title}
          >
            {title}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <ActionTooltip
            label={isFocusMode ? "Exit focus mode" : "Focus mode"}
            shortcut={getEditorShortcutLabel("focusMode")}
            side="bottom"
          >
            <button
              type="button"
              onClick={onToggleFocusMode}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
              aria-label={isFocusMode ? "Exit focus mode" : "Focus mode"}
            >
              {isFocusMode ? (
                <Minimize2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
              ) : (
                <Expand className="h-[13px] w-[13px]" strokeWidth={1.5} />
              )}
            </button>
          </ActionTooltip>

          <ActionTooltip label="Notes panel" side="bottom">
            <button
              type="button"
              onClick={() => onTogglePanel("notes")}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-muted hover:text-ink",
                activePanel === "notes" && "bg-muted text-ink",
              )}
              aria-label="Notes panel"
              aria-pressed={activePanel === "notes"}
            >
              <AlignLeft className="h-[13px] w-[13px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>

          <ActionTooltip label="Properties panel" side="bottom">
            <button
              type="button"
              onClick={() => onTogglePanel("properties")}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-muted hover:text-ink",
                activePanel === "properties" && "bg-muted text-ink",
              )}
              aria-label="Properties panel"
              aria-pressed={activePanel === "properties"}
            >
              <SlidersHorizontal className="h-[13px] w-[13px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
