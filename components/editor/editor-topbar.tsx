"use client"

import type { ComponentType } from "react"
import type { Editor } from "@tiptap/react"
import {
  AlignLeft,
  Bold,
  Check,
  ChevronDown,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutLabel, type EditorShortcutAction } from "@/lib/editor/shortcuts"
import {
  EDITOR_TOPBAR_COMPACT_FORMAT_CLASS,
  EDITOR_TOPBAR_COMPACT_TRIGGER_ID,
  EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS,
  EDITOR_TOPBAR_TITLE_CONTAINER_CLASS,
  runCompactTopbarAction,
} from "@/lib/editor/topbar-compact"
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

const COMPACT_QUICK_ACTIONS: TopbarActionItem[] = FORMAT_ACTIONS.filter(
  ({ action }) =>
    action === "bold" ||
    action === "italic" ||
    action === "strike" ||
    action === "highlight" ||
    action === "link" ||
    action === "footnote",
)

const COMPACT_LIST_ACTIONS: Array<{
  id: string
  label: string
  action: EditorShortcutAction
  text?: string
}> = [
  ...STRUCTURE_ACTIONS,
  { id: "editor-action-blockquote", label: "Block quote", action: "blockquote", text: ">" },
  { id: "editor-action-bullet-list", label: "Bulleted list", action: "bulletList", text: "-" },
  {
    id: "editor-action-ordered-list",
    label: "Numbered list",
    action: "orderedList",
    text: "1.",
  },
  { id: "editor-action-inline-code", label: "Inline code", action: "inlineCode" },
  { id: "editor-action-table", label: "Table", action: "table" },
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
  const formatButtons = FORMAT_ACTIONS.map((actionItem) => {
    const Icon = actionItem.icon

    return (
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
            isActionActive(editor, actionItem.action) ? "bg-muted text-ink" : "hover:bg-muted hover:text-ink",
          )}
        >
          <Icon className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>
      </ActionTooltip>
    )
  })

  const structureButtons = STRUCTURE_ACTIONS.map((actionItem) => (
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
          isActionActive(editor, actionItem.action) ? "bg-muted text-ink" : "text-ink-3 hover:bg-muted hover:text-ink",
        )}
      >
        {actionItem.text}
      </button>
    </ActionTooltip>
  ))

  const compactQuickButtons = COMPACT_QUICK_ACTIONS.map((actionItem) => {
    const Icon = actionItem.icon

    return (
      <DropdownMenuItem
        key={`${actionItem.id}-compact-quick`}
        onSelect={(event) => runCompactTopbarAction(onRunAction, actionItem.action, event)}
        aria-label={actionItem.label}
        className={cn(
          "h-8 justify-center rounded-[8px] p-0",
          isActionActive(editor, actionItem.action) ? "bg-muted text-ink" : "text-ink-3 hover:bg-muted hover:text-ink",
        )}
      >
        <Icon className="h-[13px] w-[13px]" strokeWidth={1.5} />
      </DropdownMenuItem>
    )
  })

  const compactListButtons = COMPACT_LIST_ACTIONS.map((actionItem) => {
    const active = isActionActive(editor, actionItem.action)
    const shortcut = getEditorShortcutLabel(actionItem.action)
    const displayText = actionItem.text ?? actionItem.label

    return (
      <DropdownMenuItem
        key={`${actionItem.id}-compact-list`}
        onSelect={() => runCompactTopbarAction(onRunAction, actionItem.action)}
        className={cn("h-9 rounded-[8px] px-2.5 text-[14px]", active ? "bg-muted text-ink" : "text-ink-2")}
      >
        <span
          aria-hidden="true"
          className={cn("mr-2 inline-flex h-4 w-4 items-center justify-center text-ink-4", active && "text-ink")}
        >
          {active ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> : null}
        </span>
        <span className="truncate">{displayText}</span>
        {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    )
  })

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
            className={EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS}
            aria-disabled={false}
          >
            {formatButtons}

            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

            {structureButtons}
          </div>

          <div className={EDITOR_TOPBAR_COMPACT_FORMAT_CLASS}>
            <DropdownMenu>
              <ActionTooltip label="Format menu" side="bottom">
                <DropdownMenuTrigger asChild>
                  <button
                    id={EDITOR_TOPBAR_COMPACT_TRIGGER_ID}
                    type="button"
                    aria-label="Format menu"
                    className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border-[0.5px] border-border bg-sb px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-muted hover:text-ink"
                  >
                    <span className="font-medium tracking-[-0.01em]">Aa</span>
                    <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </DropdownMenuTrigger>
              </ActionTooltip>

              <DropdownMenuContent
                align="start"
                side="bottom"
                sideOffset={8}
                className="w-[294px] rounded-[16px] border-[0.5px] border-border bg-sb p-2.5 shadow-float-md"
              >
                <div className="mb-1.5 grid grid-cols-6 gap-1">
                  {compactQuickButtons}
                </div>

                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-[0.07em] text-ink-4">
                  Structure
                </DropdownMenuLabel>

                {compactListButtons}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className={EDITOR_TOPBAR_TITLE_CONTAINER_CLASS}>
          <button
            type="button"
            onClick={onOpenRenameModal}
            className="pointer-events-auto w-full max-w-[460px] truncate px-3 text-center font-lora text-[13px] text-ink-3 transition-colors hover:text-ink"
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
