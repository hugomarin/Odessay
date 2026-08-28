"use client"

import { useEffect, useState } from "react"
import { AlignLeft, Scan } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { EditorTabs } from "@/components/editor/editor-tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { cn } from "@/lib/utils"
import type { LocalEditorSessionTab } from "@/lib/local-db/schema"
import type { WritingStatus } from "@/lib/writings/status"

/**
 * Studio titlebar — 46px, edge to edge, a sibling of the whole middle band
 * (docs/design/layout.md §2). It carries the tab strip and the window-level
 * actions only: focus mode and the right panel. Grammar lost its own button
 * here once it became a tab of that panel — the shortcut still opens it
 * (owner review). The format toolbar belongs to the sheet's header row.
 */

type EditorTopbarProps = {
  isFocusMode: boolean
  activePanel: "notes" | "properties" | "grammar" | "share" | null
  tabs: LocalEditorSessionTab[]
  /** Editorial state per tab id, drawn as each tab's glyph. */
  tabStatuses?: Record<string, WritingStatus | null>
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onRenameTab: (tabId: string) => void
  onReorderTab: (tabId: string, targetTabId: string) => void
  onNewTab: () => void
  onToggleFocusMode: () => void
  onTogglePanel: (panel: "notes" | "properties" | "grammar") => void
  isTabBarVisible?: boolean
}

const TITLEBAR_BUTTON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-ink-2 transition-colors duration-150 ease-out hover:bg-muted-hover hover:text-ink"

const TITLEBAR_BUTTON_ACTIVE_CLASS = "bg-surface-selected text-ink"

export function EditorTopbar({
  isFocusMode,
  activePanel,
  tabs,
  tabStatuses,
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
  /**
   * On desktop the window uses an overlay title bar, so the traffic lights sit
   * on top of this row instead of in a strip of their own. We reserve their
   * width on the left and make the bar itself draggable. Resolved in an effect
   * because the static export prerenders without the Tauri global, and reading
   * it during render would desync hydration.
   */
  const [isDesktopTitlebar, setIsDesktopTitlebar] = useState(false)

  useEffect(() => {
    setIsDesktopTitlebar(isTauriRuntime())
  }, [])

  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="editor-topbar"
        data-section="editor-topbar"
        data-testid="editor-topbar"
        data-tauri-drag-region={isDesktopTitlebar ? true : undefined}
        className="EditorTopbar od-drag-region flex h-[46px] shrink-0 items-center gap-3.5 bg-transparent pl-4 pr-3.5"
        style={
          isDesktopTitlebar
            ? {
                // The traffic lights and the sidebar toggle share this row and
                // sit at window coordinates, while this bar starts after the
                // sidebar. Reserve whatever of that strip overlaps the tabs.
                paddingLeft: "max(16px, calc(126px - var(--app-shell-left-offset, 0px)))",
                /*
                 * Centring the tabs in this 46px box puts them at 23, but macOS
                 * clamps `trafficLightPosition` and draws the 12px lights at
                 * ~20 — centre 26 — which is what the rail toggle is measured
                 * against (components/navigation/sidebar.tsx). 6px of top
                 * padding leaves a 40px content box whose centre is 6 + 20 = 26,
                 * so tabs, lights and toggle share one axis. The row's own
                 * height is untouched, so nothing below it moves.
                 * Re-measure on the DMG before changing it: `tauri dev` and the
                 * browser do not clamp, so neither shows this.
                 */
                paddingTop: "6px",
              }
            : undefined
        }
      >
        <div data-tauri-drag-region className="od-drag-region flex min-w-0 flex-1 items-center overflow-hidden">
          {isTabBarVisible ? (
            <EditorTabs
              tabs={tabs}
              tabStatuses={tabStatuses}
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
