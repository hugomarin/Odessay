"use client"

import type { Editor } from "@tiptap/react"
import { ChevronRight, FolderTree, ListTree, Pencil } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { EditorFormatToolbar } from "@/components/editor/editor-format-toolbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { RunEditorAction } from "@/lib/editor/topbar-compact"
import { cn } from "@/lib/utils"

/**
 * The sheet's header row — 56px, inside the sheet column, never in the window
 * band (docs/design/layout.md §2). Left: the grouped panel toggles, the
 * breadcrumb lead and the artifact name with its rename affordance. Right: the
 * format toolbar. Values read from the render of the Studio prototype.
 */

export type EditorLeftPanelMode = "toc" | "workspace" | null

type EditorSheetHeaderProps = {
  editor: Editor | null
  mode: "rich" | "markdown"
  onRunAction: RunEditorAction
  title: string
  workspaceName: string | null
  folderName: string | null
  onRename: () => void
  leftPanel: EditorLeftPanelMode
  onToggleLeftPanel: (panel: Exclude<EditorLeftPanelMode, null>) => void
  /** The grouped toggles only surface here when the ghost rail cannot show. */
  showPanelToggles: boolean
}

const HEADER_GHOST_BUTTON_CLASS =
  "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 ease-out hover:bg-surface-menu-hover hover:text-ink"

export function EditorSheetHeader({
  editor,
  mode,
  onRunAction,
  title,
  workspaceName,
  folderName,
  onRename,
  leftPanel,
  onToggleLeftPanel,
  showPanelToggles,
}: EditorSheetHeaderProps) {
  const crumbs = [workspaceName, folderName].filter((crumb): crumb is string => Boolean(crumb))

  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="editor-sheet-header"
        data-section="editor-sheet-header"
        data-testid="editor-sheet-header"
        className="EditorSheetHeader relative z-10 flex h-14 shrink-0 items-center justify-between gap-6 border-b-[0.5px] border-line-soft bg-sb pl-7 pr-5 font-sans"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {showPanelToggles ? (
            <span className="mr-1 flex shrink-0 items-center gap-0.5">
              <ActionTooltip label="Table of contents" side="bottom">
                <button
                  type="button"
                  onClick={() => onToggleLeftPanel("toc")}
                  aria-label="Table of contents"
                  aria-pressed={leftPanel === "toc"}
                  className={cn(HEADER_GHOST_BUTTON_CLASS, leftPanel === "toc" && "bg-surface-menu-hover text-ink")}
                >
                  <ListTree className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </ActionTooltip>
              <ActionTooltip label="Workspace" side="bottom">
                <button
                  type="button"
                  onClick={() => onToggleLeftPanel("workspace")}
                  aria-label="Workspace"
                  aria-pressed={leftPanel === "workspace"}
                  className={cn(
                    HEADER_GHOST_BUTTON_CLASS,
                    leftPanel === "workspace" && "bg-surface-menu-hover text-ink",
                  )}
                >
                  <FolderTree className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </ActionTooltip>
            </span>
          ) : null}

          {crumbs.length > 0 ? (
            <span
              data-testid="editor-sheet-breadcrumb"
              className="hidden shrink-0 items-center gap-2 lg:flex"
            >
              {crumbs.map((crumb) => (
                <span key={crumb} className="flex items-center gap-2">
                  <span className="whitespace-nowrap text-sm text-ink-3">{crumb}</span>
                  <ChevronRight className="h-[13px] w-[13px] text-ink-5" strokeWidth={1.5} />
                </span>
              ))}
            </span>
          ) : null}

          <span
            data-testid="editor-sheet-title"
            onDoubleClick={onRename}
            title={title}
            className="min-w-[48px] shrink cursor-text truncate text-sm font-normal leading-[1.4] text-ink"
          >
            {title}
          </span>

          <ActionTooltip label="Rename artifact" side="bottom">
            <button
              type="button"
              onClick={onRename}
              aria-label="Rename artifact"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors duration-150 ease-out hover:bg-surface-menu-hover hover:text-ink"
            >
              <Pencil className="h-[14px] w-[14px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>
        </div>

        <EditorFormatToolbar editor={editor} mode={mode} onRunAction={onRunAction} />
      </div>
    </TooltipProvider>
  )
}
