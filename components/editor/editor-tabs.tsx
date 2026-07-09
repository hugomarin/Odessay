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
  onReorderTab: (tabId: string, targetTabId: string) => void;
  onNewTab: () => void;
};

const DRAG_THRESHOLD_PX = 4;
const AUTO_SCROLL_MARGIN_PX = 40;
const AUTO_SCROLL_SPEED_PX = 8;

export function EditorTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onReorderTab,
  onNewTab,
}: EditorTabsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragTargetTabId, setDragTargetTabId] = useState<string | null>(null);

  const dragStateRef = useRef<{
    pointerId: number | null;
    tabId: string | null;
    tabElement: HTMLElement | null;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    dragging: boolean;
    ghost: HTMLElement | null;
    scrollInterval: ReturnType<typeof setInterval> | null;
  }>({
    pointerId: null,
    tabId: null,
    tabElement: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    ghost: null,
    scrollInterval: null,
  });

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

  const findTabIdFromPoint = (clientX: number, clientY: number): string | null => {
    const elements = document.elementsFromPoint(clientX, clientY);
    for (const element of elements) {
      if (element instanceof HTMLElement) {
        const tabElement = element.closest("[data-editor-tab-id]");
        if (tabElement instanceof HTMLElement) {
          return tabElement.dataset.editorTabId ?? null;
        }
      }
    }
    return null;
  };

  const stopAutoScroll = () => {
    const state = dragStateRef.current;
    if (state.scrollInterval) {
      clearInterval(state.scrollInterval);
      state.scrollInterval = null;
    }
  };

  const updateAutoScroll = (clientX: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const rect = scroller.getBoundingClientRect();
    const distanceFromLeft = clientX - rect.left;
    const distanceFromRight = rect.right - clientX;

    stopAutoScroll();

    if (distanceFromLeft < AUTO_SCROLL_MARGIN_PX && scroller.scrollLeft > 0) {
      dragStateRef.current.scrollInterval = setInterval(() => {
        scroller.scrollLeft -= AUTO_SCROLL_SPEED_PX;
      }, 16);
    } else if (
      distanceFromRight < AUTO_SCROLL_MARGIN_PX &&
      scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth
    ) {
      dragStateRef.current.scrollInterval = setInterval(() => {
        scroller.scrollLeft += AUTO_SCROLL_SPEED_PX;
      }, 16);
    }
  };

  const cleanupDrag = () => {
    const state = dragStateRef.current;
    if (state.tabElement && state.pointerId !== null) {
      try {
        state.tabElement.releasePointerCapture(state.pointerId);
      } catch {
        // ignore
      }
    }
    if (state.ghost) {
      state.ghost.remove();
    }
    stopAutoScroll();
    dragStateRef.current = {
      pointerId: null,
      tabId: null,
      tabElement: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      dragging: false,
      ghost: null,
      scrollInterval: null,
    };
    setDraggedTabId(null);
    setDragTargetTabId(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, tabId: string) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-tab-action='true']")) {
      return;
    }

    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);

    const rect = element.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      tabId,
      tabElement: element,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      dragging: false,
      ghost: null,
      scrollInterval: null,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId === null || state.tabId === null || !state.tabElement) {
      return;
    }

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (!state.dragging) {
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) {
        return;
      }

      const rect = state.tabElement.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className =
        "fixed z-[100] flex h-[46px] items-center overflow-hidden rounded-t-[10px] border border-b-0 border-transparent bg-bg px-4 text-ink shadow-[0_-3px_8px_rgba(35,24,15,0.035),0_12px_22px_rgba(35,24,15,0.05),0_2px_6px_rgba(35,24,15,0.04)]";
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.opacity = "0.92";

      const title = tabs.find((t) => t.id === state.tabId)?.title ?? "";
      const titleSpan = document.createElement("span");
      titleSpan.className =
        "block min-w-0 flex-1 truncate text-[14px] font-normal leading-none tracking-[-0.01em]";
      titleSpan.textContent = title;
      ghost.appendChild(titleSpan);

      document.body.appendChild(ghost);

      state.ghost = ghost;
      state.dragging = true;
      setDraggedTabId(state.tabId);
      updateAutoScroll(event.clientX);
    }

    if (state.ghost) {
      state.ghost.style.left = `${event.clientX - state.offsetX}px`;
      state.ghost.style.top = `${event.clientY - state.offsetY}px`;
    }

    const targetTabId = findTabIdFromPoint(event.clientX, event.clientY);
    if (targetTabId && targetTabId !== state.tabId) {
      setDragTargetTabId(targetTabId);
    } else if (!targetTabId) {
      setDragTargetTabId(null);
    }

    updateAutoScroll(event.clientX);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId === null) {
      return;
    }

    if (state.dragging && state.tabId) {
      const targetTabId = findTabIdFromPoint(event.clientX, event.clientY);
      if (targetTabId && targetTabId !== state.tabId) {
        onReorderTab(state.tabId, targetTabId);
      }
    }

    cleanupDrag();
  };

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
              isDragging={tab.id === draggedTabId}
              isDragTarget={tab.id === dragTargetTabId && tab.id !== draggedTabId}
              onPointerDown={(event) => handlePointerDown(event, tab.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
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
