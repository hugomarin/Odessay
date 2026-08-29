"use client"

import { useRef, type ComponentType } from "react"
import type { Editor } from "@tiptap/react"
import {
  Bold,
  Check,
  ChevronDown,
  Code2,
  Italic,
  Link,
  List,
  ListOrdered,
  Strikethrough,
  Table,
  Image,
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
import { getEditorShortcutLabel, type EditorShortcutAction } from "@/lib/editor/shortcuts"
import {
  EDITOR_TOPBAR_COMPACT_FORMAT_CLASS,
  EDITOR_TOPBAR_COMPACT_TRIGGER_ID,
  EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS,
  type RichSelectionRange,
  type RunEditorAction,
  runCompactTopbarAction,
} from "@/lib/editor/topbar-compact"
import { cn } from "@/lib/utils"
import { useEditorActionState, type TopbarTrackedAction } from "@/hooks/useEditorState"

/**
 * Format toolbar — it lives inside the sheet's header row, not in the window
 * titlebar (docs/design/layout.md §2: everything that accompanies the content
 * lives inside the sheet's column).
 *
 * Geometry read from the render of `Artifact Studio Studio.dc.html`: 30px
 * buttons at radius 6, 16px icons, a 1px · 18px divider with 8px margins, and
 * menu triggers of 30px with a 13/400 label.
 */

type ToolbarActionItem = {
  id: string
  label: string
  action: EditorShortcutAction
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  /** The prototype draws bold, italic and strike at stroke 2; code-xml at 1.75. */
  strokeWidth: number
}

type StructureActionItem = {
  id: string
  label: string
  action: EditorShortcutAction
  text: string
}

type MenuActionItem = {
  id: string
  label: string
  action: EditorShortcutAction
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
}

const FORMAT_ACTIONS: ToolbarActionItem[] = [
  { id: "editor-action-bold", label: "Bold", action: "bold", icon: Bold, strokeWidth: 2 },
  { id: "editor-action-italic", label: "Italic", action: "italic", icon: Italic, strokeWidth: 2 },
  { id: "editor-action-strike", label: "Strike", action: "strike", icon: Strikethrough, strokeWidth: 2 },
  { id: "editor-action-inline-code", label: "Inline code", action: "inlineCode", icon: Code2, strokeWidth: 1.75 },
]

const TEXT_MENU_ACTIONS: StructureActionItem[] = [
  { id: "editor-action-paragraph", label: "Normal", action: "paragraph", text: "Aa" },
  { id: "editor-action-heading-1", label: "Heading 1", action: "heading1", text: "H1" },
  { id: "editor-action-heading-2", label: "Heading 2", action: "heading2", text: "H2" },
  { id: "editor-action-heading-3", label: "Heading 3", action: "heading3", text: "H3" },
  { id: "editor-action-blockquote", label: "Blockquote", action: "blockquote", text: ">" },
  { id: "editor-action-code-block", label: "Code", action: "codeBlock", text: "</>" },
]

const LIST_MENU_ACTIONS: MenuActionItem[] = [
  { id: "editor-action-bullet-list", label: "• List", action: "bulletList", icon: List },
  { id: "editor-action-ordered-list", label: "# List", action: "orderedList", icon: ListOrdered },
]

const INSERT_MENU_ACTIONS: MenuActionItem[] = [
  { id: "editor-action-image", label: "Image", action: "image", icon: Image },
  { id: "editor-action-table", label: "Table", action: "table", icon: Table },
  { id: "editor-action-link", label: "Link", action: "link", icon: Link },
]

const COMPACT_QUICK_ACTIONS: ToolbarActionItem[] = [
  ...FORMAT_ACTIONS,
  { id: "editor-action-link", label: "Link", action: "link", icon: Link, strokeWidth: 1.5 },
  { id: "editor-action-image", label: "Image", action: "image", icon: Image, strokeWidth: 1.5 },
]

const COMPACT_LIST_ACTIONS: Array<{
  id: string
  label: string
  action: EditorShortcutAction
  text?: string
}> = [
  ...TEXT_MENU_ACTIONS,
  { id: "editor-action-bullet-list", label: "Bulleted list", action: "bulletList", text: "-" },
  { id: "editor-action-ordered-list", label: "Numbered list", action: "orderedList", text: "1." },
  { id: "editor-action-inline-code", label: "Inline code", action: "inlineCode" },
  { id: "editor-action-link", label: "Link", action: "link" },
  { id: "editor-action-table", label: "Table", action: "table" },
  { id: "editor-action-image", label: "Image", action: "image" },
]

const TOOLBAR_TRACKED_ACTIONS: ReadonlySet<TopbarTrackedAction> = new Set([
  "bold",
  "italic",
  "strike",
  "highlight",
  "link",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "inlineCode",
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "table",
  "image",
])

const isToolbarTrackedAction = (action: EditorShortcutAction): action is TopbarTrackedAction =>
  TOOLBAR_TRACKED_ACTIONS.has(action as TopbarTrackedAction)

const isActionActive = (
  actionState: ReturnType<typeof useEditorActionState>,
  action: EditorShortcutAction,
) => (isToolbarTrackedAction(action) ? actionState[action] : false)

const TOOLBAR_BUTTON_CLASS =
  "inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-ink-3 transition-colors duration-150 ease-out hover:bg-surface-menu-hover hover:text-ink"

const TOOLBAR_BUTTON_ACTIVE_CLASS = "bg-surface-menu-hover text-ink [&>svg]:text-ink"

const TOOLBAR_TRIGGER_CLASS =
  "inline-flex h-[30px] items-center gap-[5px] rounded-md px-[9px] text-[13px] text-ink-2 transition-colors duration-150 ease-out hover:bg-surface-menu-hover hover:text-ink [&>svg]:text-ink-3"

const MENU_CONTENT_CLASS = "w-[214px]"

type EditorFormatToolbarProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  onRunAction: RunEditorAction
}

export function EditorFormatToolbar({ editor, mode, onRunAction }: EditorFormatToolbarProps) {
  const pendingRichSelectionRef = useRef<RichSelectionRange | null>(null)
  const actionState = useEditorActionState(editor)

  const captureSelectionAndKeepFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (mode !== "rich" || !editor) {
      pendingRichSelectionRef.current = null
      return
    }

    const { from, to } = editor.state.selection
    pendingRichSelectionRef.current = { from, to }
  }

  const consumeRichSelection = (): RichSelectionRange | undefined => {
    const pending = pendingRichSelectionRef.current
    pendingRichSelectionRef.current = null
    return pending ?? undefined
  }

  const formatButtons = FORMAT_ACTIONS.map((actionItem) => {
    const Icon = actionItem.icon
    const isActive = isActionActive(actionState, actionItem.action)

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
          onMouseDown={(event) => {
            // Keep editor/textarea selection stable when triggering formatting from the toolbar.
            captureSelectionAndKeepFocus(event)
          }}
          onClick={() => onRunAction(actionItem.action, { richSelection: consumeRichSelection() })}
          aria-label={actionItem.label}
          className={cn(TOOLBAR_BUTTON_CLASS, isActive && TOOLBAR_BUTTON_ACTIVE_CLASS)}
        >
          <Icon className="h-4 w-4" strokeWidth={actionItem.strokeWidth} />
        </button>
      </ActionTooltip>
    )
  })

  const compactQuickButtons = COMPACT_QUICK_ACTIONS.map((actionItem) => {
    const Icon = actionItem.icon

    return (
      <DropdownMenuItem
        key={`${actionItem.id}-compact-quick`}
        onSelect={(event) =>
          runCompactTopbarAction(onRunAction, actionItem.action, {
            event,
            richSelection: consumeRichSelection(),
          })
        }
        aria-label={actionItem.label}
        className={cn(
          "h-8 justify-center rounded-[7px] p-0",
          isActionActive(actionState, actionItem.action) && TOOLBAR_BUTTON_ACTIVE_CLASS,
        )}
      >
        <Icon className="h-[13px] w-[13px]" strokeWidth={1.5} />
      </DropdownMenuItem>
    )
  })

  const compactListButtons = COMPACT_LIST_ACTIONS.map((actionItem) => {
    const active = isActionActive(actionState, actionItem.action)
    const shortcut = getEditorShortcutLabel(actionItem.action)
    const displayText = actionItem.text ?? actionItem.label

    return (
      <DropdownMenuItem
        key={`${actionItem.id}-compact-list`}
        onSelect={() =>
          runCompactTopbarAction(onRunAction, actionItem.action, {
            richSelection: consumeRichSelection(),
          })
        }
        icon={active ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> : null}
        className={cn(active && TOOLBAR_BUTTON_ACTIVE_CLASS)}
      >
        <span className="truncate">{displayText}</span>
        {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    )
  })

  const textMenuItems = TEXT_MENU_ACTIONS.map((actionItem) => {
    const active = isActionActive(actionState, actionItem.action)
    const shortcut = getEditorShortcutLabel(actionItem.action)

    return (
      <DropdownMenuItem
        key={`${actionItem.id}-text`}
        onSelect={() =>
          runCompactTopbarAction(onRunAction, actionItem.action, {
            richSelection: consumeRichSelection(),
          })
        }
        icon={
          <span className={cn("text-[13px] font-medium", active ? "text-ink" : "text-ink-4")}>
            {actionItem.text}
          </span>
        }
        className={cn("text-[14px]", active && TOOLBAR_BUTTON_ACTIVE_CLASS)}
      >
        <span className="flex-1 truncate text-left">{actionItem.label}</span>
        {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
      </DropdownMenuItem>
    )
  })

  const buildIconMenuItems = (items: MenuActionItem[], keySuffix: string) =>
    items.map((actionItem) => {
      const Icon = actionItem.icon
      const active = isActionActive(actionState, actionItem.action)
      const shortcut = getEditorShortcutLabel(actionItem.action)

      return (
        <DropdownMenuItem
          key={`${actionItem.id}-${keySuffix}`}
          onSelect={() =>
            runCompactTopbarAction(onRunAction, actionItem.action, {
              richSelection: consumeRichSelection(),
            })
          }
          icon={Icon ? <Icon className="h-4 w-4" strokeWidth={1.5} /> : null}
          className={cn("text-[14px]", active && TOOLBAR_BUTTON_ACTIVE_CLASS)}
        >
          <span className="flex-1 truncate text-left">{actionItem.label}</span>
          {shortcut ? <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut> : null}
        </DropdownMenuItem>
      )
    })

  const textMenuLabel = actionState.heading1
    ? "H1"
    : actionState.heading2
      ? "H2"
      : actionState.heading3
        ? "H3"
        : actionState.blockquote
          ? "Quote"
          : actionState.codeBlock
            ? "Code"
            : "Text"
  const listMenuLabel = actionState.orderedList ? "# List" : actionState.bulletList ? "• List" : "List"

  return (
    <div
      id="editor-format-toolbar"
      data-section="editor-format-toolbar"
      data-testid="editor-format-toolbar"
      className="EditorFormatToolbar flex shrink-0 items-center"
    >
      <div className={EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS}>
        <div className="flex items-center gap-px">{formatButtons}</div>

        <span className="mx-2 h-[18px] w-px bg-line-soft" aria-hidden="true" />

        <DropdownMenu>
          <ActionTooltip label="Lists" side="bottom">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseDown={captureSelectionAndKeepFocus}
                aria-label="Lists"
                className={cn(
                  TOOLBAR_TRIGGER_CLASS,
                  (actionState.bulletList || actionState.orderedList) && TOOLBAR_BUTTON_ACTIVE_CLASS,
                )}
              >
                <span>{listMenuLabel}</span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </ActionTooltip>
          <DropdownMenuContent align="end" side="bottom" sideOffset={8} className={MENU_CONTENT_CLASS}>
            {buildIconMenuItems(LIST_MENU_ACTIONS, "list")}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <ActionTooltip label="Text" side="bottom">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseDown={captureSelectionAndKeepFocus}
                aria-label="Text"
                className={cn(
                  TOOLBAR_TRIGGER_CLASS,
                  (actionState.heading1 ||
                    actionState.heading2 ||
                    actionState.heading3 ||
                    actionState.blockquote ||
                    actionState.codeBlock) &&
                    TOOLBAR_BUTTON_ACTIVE_CLASS,
                )}
              >
                <span>{textMenuLabel}</span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </ActionTooltip>
          <DropdownMenuContent align="end" side="bottom" sideOffset={8} className={MENU_CONTENT_CLASS}>
            {textMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <ActionTooltip label="Insert" side="bottom">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseDown={captureSelectionAndKeepFocus}
                aria-label="Insert"
                className={cn(
                  TOOLBAR_TRIGGER_CLASS,
                  (actionState.link || actionState.table) && TOOLBAR_BUTTON_ACTIVE_CLASS,
                )}
              >
                <span>Insert</span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </ActionTooltip>
          <DropdownMenuContent align="end" side="bottom" sideOffset={8} className={MENU_CONTENT_CLASS}>
            {buildIconMenuItems(INSERT_MENU_ACTIONS, "insert")}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={EDITOR_TOPBAR_COMPACT_FORMAT_CLASS}>
        <DropdownMenu>
          <ActionTooltip label="Format menu" side="bottom">
            <DropdownMenuTrigger asChild>
              <button
                id={EDITOR_TOPBAR_COMPACT_TRIGGER_ID}
                type="button"
                onMouseDown={captureSelectionAndKeepFocus}
                aria-label="Format menu"
                className={TOOLBAR_TRIGGER_CLASS}
              >
                <span className="font-medium tracking-[-0.01em]">Aa</span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </ActionTooltip>

          <DropdownMenuContent align="end" side="bottom" sideOffset={8} className="w-[294px] max-w-[294px]">
            <div className="mb-1.5 grid grid-cols-6 gap-1">{compactQuickButtons}</div>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Structure</DropdownMenuLabel>

            {compactListButtons}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
