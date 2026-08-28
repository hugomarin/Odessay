"use client"

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { EditorTabItem } from "@/components/editor/editor-tab-item";
import { getEditorShortcutLabel } from "@/lib/editor/shortcuts";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";
import type { WritingStatus } from "@/lib/writings/status";

type EditorTabsProps = {
  tabs: LocalEditorSessionTab[];
  tabStatuses?: Record<string, WritingStatus | null>;
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
  tabStatuses,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onReorderTab,
  onNewTab,
}: EditorTabsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
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

    // Do NOT call event.preventDefault() here: in WKWebView (Tauri desktop),
    // canceling pointerdown suppresses the compatibility click event, which
    // would kill tab selection. Text selection is already blocked by the
    // `select-none` class on the tab, so preventDefault is unnecessary.
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
        "fixed z-[100] flex h-[36px] items-center overflow-hidden rounded-lg bg-sb px-3 text-ink shadow-[0_1px_2px_rgba(35,24,15,0.06),0_10px_30px_rgba(35,24,15,0.05)]";
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.opacity = "0.92";

      const title = tabs.find((t) => t.id === state.tabId)?.title ?? "";
      const titleSpan = document.createElement("span");
      titleSpan.className = "block min-w-0 flex-1 truncate text-[13px] font-medium leading-none";
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

    const wasDragging = state.dragging;
    const tabId = state.tabId;

    if (wasDragging && tabId) {
      const targetTabId = findTabIdFromPoint(event.clientX, event.clientY);
      if (targetTabId && targetTabId !== tabId) {
        onReorderTab(tabId, targetTabId);
      }
    }

    cleanupDrag();

    // Selection is driven from pointerup (not the inner button's click) because
    // WKWebView suppresses the click when the gesture involves pointer capture.
    // Only treat it as a select when the pointer did not turn into a drag.
    if (!wasDragging && tabId) {
      onSelectTab(tabId);
    }
  };

  const handlePointerCancel = () => {
    cleanupDrag();
  };

  return (
    // The empty parts of the strip drag the desktop window: with an overlay
    // title bar this row is all the window has left to grab. Inert on web.
    <div
      data-tauri-drag-region
      className="od-drag-region flex h-full min-w-0 flex-1 items-center overflow-hidden bg-transparent"
    >
      <div
        ref={scrollerRef}
        data-tauri-drag-region
        className="od-drag-region min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div data-tauri-drag-region className="inline-flex min-w-full items-center">
          {tabs.map((tab) => (
            <EditorTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              status={tabStatuses?.[tab.id] ?? null}
              onSelect={onSelectTab}
              onClose={onCloseTab}
              onRename={onRenameTab}
              isDragging={tab.id === draggedTabId}
              isDragTarget={tab.id === dragTargetTabId && tab.id !== draggedTabId}
              onPointerDown={(event) => handlePointerDown(event, tab.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          ))}

          <ActionTooltip label="New writing" shortcut={getEditorShortcutLabel("newWriting")} side="bottom">
            <button
              type="button"
              onClick={onNewTab}
              className="ml-[10px] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors duration-150 ease-out hover:bg-muted-hover hover:text-ink"
              aria-label="New writing"
            >
              <Plus className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
          </ActionTooltip>
        </div>
      </div>
    </div>
  );
}
