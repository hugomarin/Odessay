"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Header of the right panel — 46px, matching the left panel's single header row
 * (components/editor/panels/editor-navigation-sidebar.tsx).
 *
 * The four surfaces used to be separate panels, each with a header and a close
 * button of its own, and Share was not one of them: it lived as a section
 * inside Properties. Tabs make them one panel the author switches inside,
 * instead of three destinations reached from the titlebar (owner review).
 */

export type EditorRightPanelTab = "properties" | "grammar" | "notes" | "share";

export const EDITOR_RIGHT_PANEL_TABS: {
  id: EditorRightPanelTab;
  label: string;
}[] = [
  { id: "properties", label: "Properties" },
  { id: "grammar", label: "Grammar" },
  { id: "notes", label: "Notes" },
  { id: "share", label: "Share" },
];

export function EditorRightPanelTabs({
  active,
  onSelect,
  onClose,
  badges,
}: {
  active: EditorRightPanelTab;
  onSelect: (tab: EditorRightPanelTab) => void;
  onClose: () => void;
  /** Per-tab count, e.g. pending corrections on Grammar. */
  badges?: Partial<Record<EditorRightPanelTab, number>>;
}) {
  return (
    <div
      data-testid="editor-right-panel-tabs"
      className="flex h-[46px] shrink-0 items-center gap-0.5 border-b-[0.5px] border-border pl-2 pr-1.5"
    >
      <div role="tablist" aria-label="Panel" className="flex min-w-0 flex-1 items-center gap-0.5">
        {EDITOR_RIGHT_PANEL_TABS.map((tab) => {
          const isActive = tab.id === active;
          const badge = badges?.[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "inline-flex h-[26px] shrink-0 items-center gap-1 rounded-[7px] px-2 text-[11.5px] transition-colors",
                isActive
                  ? "bg-surface-selected text-ink"
                  : "text-ink-3 hover:bg-muted-hover hover:text-ink",
              )}
            >
              <span>{tab.label}</span>
              {typeof badge === "number" && badge > 0 ? (
                <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[hsl(22,55%,92%)] px-1 text-[9.5px] font-medium text-cursor">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted-hover hover:text-ink"
      >
        <X className="h-[13px] w-[13px]" strokeWidth={1.5} />
      </button>
    </div>
  );
}
