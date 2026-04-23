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
    <div className="flex h-full min-w-0 flex-1 items-end gap-2 overflow-hidden bg-[linear-gradient(180deg,hsla(38,10%,94%,0.72),hsla(38,10%,94%,0.18))] px-3 pt-[6px]">
      <div className="flex min-w-0 max-w-[calc(100%-42px)] flex-none items-end gap-1.5 overflow-x-auto pb-0">
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
          className="mb-[2px] inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-transparent text-ink-4 transition-[background-color,border-color,color] duration-150 ease-out hover:border-border/80 hover:bg-muted hover:text-ink"
          aria-label="New writing"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </ActionTooltip>
    </div>
  );
}
