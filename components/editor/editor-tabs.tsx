"use client"

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { EditorTabItem } from "@/components/editor/editor-tab-item";
import { getEditorShortcutLabel } from "@/lib/editor/shortcuts";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";

type EditorTabsProps = {
  tabs: LocalEditorSessionTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string) => void;
  onNewTab: () => void;
};

export function EditorTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onRenameTab, onNewTab }: EditorTabsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setAvailableWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tabWidth = useMemo(() => {
    const tabCount = Math.max(tabs.length, 1);
    const gapWidth = 6;
    const plusWidth = 34;
    const plusGap = 6;
    const horizontalPadding = 12;
    const usableWidth = Math.max(
      availableWidth - plusWidth - plusGap - horizontalPadding - gapWidth * Math.max(tabCount - 1, 0),
      0,
    );
    const nextWidth = Math.floor(usableWidth / tabCount);
    const clampedWidth = Math.min(240, Math.max(72, nextWidth || 0));

    return `${clampedWidth}px`;
  }, [availableWidth, tabs.length]);

  return (
    <div className="flex h-full min-w-0 flex-1 items-end overflow-hidden bg-transparent px-3 pt-[10px]">
      <div
        ref={scrollerRef}
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="inline-flex min-w-full items-end gap-2 pr-3">
          {tabs.map((tab) => (
            <EditorTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              onRename={onRenameTab}
              widthStyle={tabWidth}
            />
          ))}

          <ActionTooltip label="New writing" shortcut={getEditorShortcutLabel("newWriting")} side="bottom">
            <button
              type="button"
              onClick={onNewTab}
              className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center self-center rounded-[10px] border-[0.5px] border-transparent text-ink-4 transition-[background-color,border-color,color] duration-150 ease-out hover:border-border/80 hover:bg-muted hover:text-ink"
              aria-label="New writing"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.45} />
            </button>
          </ActionTooltip>
        </div>
      </div>
    </div>
  );
}
