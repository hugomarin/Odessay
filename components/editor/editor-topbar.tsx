"use client"

import { AlignLeft, Scan, SpellCheck } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { EditorTabs } from "@/components/editor/editor-tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { cn } from "@/lib/utils"
import type { LocalEditorSessionTab } from "@/lib/local-db/schema"

/**
 * Studio titlebar — 46px, edge to edge, a sibling of the whole middle band
 * (docs/design/layout.md §2). It carries the tab strip and the window-level
 * actions only: focus mode, the properties panel and corrections. The format
 * toolbar belongs to the sheet's header row, not here.
 */

type EditorTopbarProps = {
  isFocusMode: boolean
  activePanel: "notes" | "properties" | "publication" | null
  isPublicationModeEnabled: boolean
  tabs: LocalEditorSessionTab[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onRenameTab: (tabId: string) => void
  onReorderTab: (tabId: string, targetTabId: string) => void
  onNewTab: () => void
  onToggleFocusMode: () => void
  onTogglePanel: (panel: "notes" | "properties" | "publication") => void
  isTabBarVisible?: boolean
}

const TITLEBAR_BUTTON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-ink-2 transition-colors duration-150 ease-out hover:bg-muted-hover hover:text-ink"

const TITLEBAR_BUTTON_ACTIVE_CLASS = "bg-surface-selected text-ink"

export function EditorTopbar({
  isFocusMode,
  activePanel,
  isPublicationModeEnabled,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onReorderTab,
  onNewTab,
  onToggleFocusMode,
  onTogglePanel,
  isTabBarVisible = true,
}: EditorTopbarProps) {
  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="editor-topbar"
        data-section="editor-topbar"
        data-testid="editor-topbar"
        className="EditorTopbar flex h-[46px] shrink-0 items-center gap-3.5 bg-transparent pl-4 pr-3.5"
      >
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {isTabBarVisible ? (
            <EditorTabs
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onRenameTab={onRenameTab}
              onReorderTab={onReorderTab}
              onNewTab={onNewTab}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <ActionTooltip
            label={isFocusMode ? "Exit focus mode" : "Focus mode"}
            shortcut={getEditorShortcutLabel("focusMode")}
            side="bottom"
          >
            <button
              type="button"
              onClick={onToggleFocusMode}
              className={cn(TITLEBAR_BUTTON_CLASS, isFocusMode && TITLEBAR_BUTTON_ACTIVE_CLASS)}
              aria-label={isFocusMode ? "Exit focus mode" : "Focus mode"}
              aria-pressed={isFocusMode}
            >
              <Scan className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>

          <ActionTooltip
            label="Corrections"
            shortcut={getEditorShortcutLabel("corrections")}
            side="bottom"
          >
            <button
              type="button"
              onClick={() => onTogglePanel("publication")}
              className={cn(
                TITLEBAR_BUTTON_CLASS,
                (isPublicationModeEnabled || activePanel === "publication") && TITLEBAR_BUTTON_ACTIVE_CLASS,
              )}
              aria-label="Corrections"
              aria-pressed={isPublicationModeEnabled || activePanel === "publication"}
            >
              <SpellCheck className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>

          <ActionTooltip
            label="Properties panel"
            shortcut={getEditorShortcutLabel("documentProperties")}
            side="bottom"
          >
            <button
              type="button"
              onClick={() => onTogglePanel("properties")}
              className={cn(TITLEBAR_BUTTON_CLASS, activePanel === "properties" && TITLEBAR_BUTTON_ACTIVE_CLASS)}
              aria-label="Properties panel"
              aria-pressed={activePanel === "properties"}
            >
              <AlignLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
