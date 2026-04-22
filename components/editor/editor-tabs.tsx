"use client"

import { Plus } from "lucide-react";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { EditorTabItem } from "@/components/editor/editor-tab-item";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";

type EditorTabsProps = {
  tabs: LocalEditorSessionTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
};

export function EditorTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: EditorTabsProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((tab) => (
          <EditorTabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={onSelectTab}
            onClose={onCloseTab}
          />
        ))}
      </div>

      <ActionTooltip label="New writing" side="bottom">
        <button
          type="button"
          onClick={onNewTab}
          className="inline-flex h-full w-[38px] shrink-0 items-center justify-center border-l-[0.5px] border-border/80 text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="New writing"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </ActionTooltip>
    </div>
  );
}
