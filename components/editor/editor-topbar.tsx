"use client"

import { useRef, type ComponentType } from "react"
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
import { EditorTabs } from "@/components/editor/editor-tabs"
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
  type RichSelectionRange,
  type RunEditorAction,
  runCompactTopbarAction,
} from "@/lib/editor/topbar-compact"
import { cn } from "@/lib/utils"
import { useEditorActionState, type TopbarTrackedAction } from "@/hooks/useEditorState"
import type { LocalEditorSessionTab } from "@/lib/local-db/schema"

type EditorTopbarProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  isFocusMode: boolean
  activePanel: "notes" | "properties" | null
  tabs: LocalEditorSessionTab[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
  onToggleFocusMode: () => void
  onTogglePanel: (panel: "notes" | "properties") => void
  onRunAction: RunEditorAction
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
  { id: "editor-action-highlight", label: "Annotate", action: "highlight", icon: Highlighter },
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

const TOPBAR_TRACKED_ACTIONS: ReadonlySet<TopbarTrackedAction> = new Set([
  "bold",
  "italic",
  "strike",
  "highlight",
  "link",
  "blockquote",
  "bulletList",
  "orderedList",
  "inlineCode",
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "table",
])

const isTopbarTrackedAction = (action: EditorShortcutAction): action is TopbarTrackedAction =>
  TOPBAR_TRACKED_ACTIONS.has(action as TopbarTrackedAction)

const isActionActive = (
  actionState: ReturnType<typeof useEditorActionState>,
  action: EditorShortcutAction,
) => (isTopbarTrackedAction(action) ? actionState[action] : false)

const TOPBAR_ICON_STROKE_WIDTH = 1.35

const TOPBAR_ICON_BUTTON_BASE_CLASS =
  "inline-flex h-6 w-6 items-center justify-center rounded-[6px] transition-[background-color,color,opacity] duration-150 ease-out"

const TOPBAR_ICON_BUTTON_INACTIVE_CLASS = "text-ink-4/70 opacity-80 hover:bg-muted/80 hover:text-ink hover:opacity-100"

const TOPBAR_ICON_BUTTON_ACTIVE_CLASS = "bg-muted/80 text-ink opacity-100"

const TOPBAR_STRUCTURE_BUTTON_BASE_CLASS =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] px-[3px] text-[11px] font-medium tracking-[-0.01em] transition-[background-color,color,opacity] duration-150 ease-out"

const TOPBAR_STRUCTURE_BUTTON_INACTIVE_CLASS =
  "text-ink-4/75 opacity-80 hover:bg-muted/80 hover:text-ink hover:opacity-100"

const TOPBAR_STRUCTURE_BUTTON_ACTIVE_CLASS = "bg-muted/80 text-ink opacity-100"

const getTopbarIconButtonClass = (active: boolean) =>
  cn(TOPBAR_ICON_BUTTON_BASE_CLASS, active ? TOPBAR_ICON_BUTTON_ACTIVE_CLASS : TOPBAR_ICON_BUTTON_INACTIVE_CLASS)

const getTopbarStructureButtonClass = (active: boolean) =>
  cn(
    TOPBAR_STRUCTURE_BUTTON_BASE_CLASS,
    active ? TOPBAR_STRUCTURE_BUTTON_ACTIVE_CLASS : TOPBAR_STRUCTURE_BUTTON_INACTIVE_CLASS,
  )

export function EditorTopbar({
  editor,
  mode,
  isFocusMode,
  activePanel,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleFocusMode,
  onTogglePanel,
  onRunAction,
}: EditorTopbarProps) {
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
            // Keep editor/textarea selection stable when triggering formatting from toolbar.
            captureSelectionAndKeepFocus(event)
          }}
          onClick={() => onRunAction(actionItem.action, { richSelection: consumeRichSelection() })}
          aria-label={actionItem.label}
          className={getTopbarIconButtonClass(isActive)}
        >
          <Icon className="h-[13px] w-[13px]" strokeWidth={TOPBAR_ICON_STROKE_WIDTH} />
        </button>
      </ActionTooltip>
    )
  })

  const structureButtons = STRUCTURE_ACTIONS.map((actionItem) => {
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
            // Prevent focus-stealing click from collapsing markdown selection before applying style.
            captureSelectionAndKeepFocus(event)
          }}
          onClick={() => onRunAction(actionItem.action, { richSelection: consumeRichSelection() })}
          aria-label={actionItem.label}
          className={getTopbarStructureButtonClass(isActive)}
        >
          {actionItem.text}
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
          "h-8 justify-center rounded-[8px] p-0",
          isActionActive(actionState, actionItem.action) ? "bg-muted text-ink" : "text-ink-3 hover:bg-muted hover:text-ink",
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
        className="EditorTopbar sticky top-0 z-20 flex h-[46px] items-center border-b-[0.5px] border-border/80 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85"
      >
        <div className="flex min-w-0 flex-1 items-center">
          <EditorTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onNewTab={onNewTab}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-l-[0.5px] border-border/80 px-3">
          <div className={EDITOR_TOPBAR_DESKTOP_FORMAT_CLASS} aria-disabled={false}>
            {formatButtons}

            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />

            {structureButtons}
          </div>

          <div className={EDITOR_TOPBAR_COMPACT_FORMAT_CLASS}>
            <DropdownMenu>
              <ActionTooltip label="Format menu" side="bottom">
                <DropdownMenuTrigger asChild>
                  <button
                    id={EDITOR_TOPBAR_COMPACT_TRIGGER_ID}
                    type="button"
                    onMouseDown={(event) => {
                      // Preserve rich selection before opening the compact menu.
                      captureSelectionAndKeepFocus(event)
                    }}
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

          <div className="flex items-center gap-1.5">
          <ActionTooltip
            label={isFocusMode ? "Exit focus mode" : "Focus mode"}
            shortcut={getEditorShortcutLabel("focusMode")}
            side="bottom"
          >
            <button
              type="button"
              onClick={onToggleFocusMode}
              className={getTopbarIconButtonClass(isFocusMode)}
              aria-label={isFocusMode ? "Exit focus mode" : "Focus mode"}
            >
              {isFocusMode ? (
                <Minimize2 className="h-[13px] w-[13px]" strokeWidth={TOPBAR_ICON_STROKE_WIDTH} />
              ) : (
                <Expand className="h-[13px] w-[13px]" strokeWidth={TOPBAR_ICON_STROKE_WIDTH} />
              )}
            </button>
          </ActionTooltip>

          <ActionTooltip label="Notes panel" side="bottom">
            <button
              type="button"
              onClick={() => onTogglePanel("notes")}
              className={getTopbarIconButtonClass(activePanel === "notes")}
              aria-label="Notes panel"
              aria-pressed={activePanel === "notes"}
            >
              <AlignLeft className="h-[13px] w-[13px]" strokeWidth={TOPBAR_ICON_STROKE_WIDTH} />
            </button>
          </ActionTooltip>

          <ActionTooltip label="Properties panel" side="bottom">
            <button
              type="button"
              onClick={() => onTogglePanel("properties")}
              className={getTopbarIconButtonClass(activePanel === "properties")}
              aria-label="Properties panel"
              aria-pressed={activePanel === "properties"}
            >
              <SlidersHorizontal className="h-[13px] w-[13px]" strokeWidth={TOPBAR_ICON_STROKE_WIDTH} />
            </button>
          </ActionTooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
