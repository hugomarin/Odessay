"use client"

import { CircleDashed, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";
import type { PointerEventHandler } from "react";

/**
 * Studio tab — geometry read from the render of
 * `docs/design/reference/Artifact Studio Studio.dc.html`: 34px tall, radius 8,
 * 200px wide with a 96px floor, 9px gap. Active takes the sheet's white; idle
 * is transparent with ink-4. The strip scrolls horizontally; the tab height
 * never shrinks.
 */

type EditorTabItemProps = {
  tab: LocalEditorSessionTab;
  active: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string) => void;
  isDragging?: boolean;
  isDragTarget?: boolean;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
};

export function EditorTabItem({
  tab,
  active,
  onSelect,
  onClose,
  onRename,
  isDragging = false,
  isDragTarget = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: EditorTabItemProps) {
  return (
    <div
      data-editor-tab-id={tab.id}
      data-active={active ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        "group relative flex h-[34px] w-[200px] min-w-[96px] shrink select-none items-center gap-[9px] overflow-hidden rounded-lg px-3 text-left font-sans transition-[background-color,color] duration-150 ease-out",
        active
          ? "bg-sb text-ink shadow-[0_1px_2px_rgba(35,24,15,0.06)]"
          : "bg-transparent text-ink-4 hover:bg-muted-hover/70",
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-45",
        isDragTarget && "ring-1 ring-inset ring-cursor/40",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelect(tab.id)
          }
        }}
        className="absolute inset-0 z-0 rounded-lg"
        aria-pressed={active}
        aria-label={`Open ${tab.title}`}
      />

      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative z-10 flex shrink-0 items-center",
          active ? "text-ink group-hover:opacity-0" : "text-ink-5",
        )}
      >
        <CircleDashed className="h-[15px] w-[15px]" strokeWidth={1.5} />
      </span>

      {/* The close affordance replaces the glyph on hover, as in the prototype,
          so the tab keeps its 200px measure whatever the pointer is doing. */}
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClose(tab.id);
          }
        }}
        data-tab-action="true"
        className="pointer-events-auto absolute left-3 z-20 hidden h-[18px] w-[18px] items-center justify-center rounded-[5px] text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink group-hover:flex"
        aria-label={`Close ${tab.title}`}
      >
        <X className="h-[14px] w-[14px]" strokeWidth={1.5} />
      </button>

      <span
        className={cn(
          "pointer-events-none relative z-10 min-w-0 flex-1 truncate text-[13px] leading-none",
          active ? "font-medium text-ink" : "font-normal text-ink-4",
        )}
      >
        {tab.title}
      </span>

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => {
          event.stopPropagation();
          onRename(tab.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onRename(tab.id);
          }
        }}
        data-tab-action="true"
        className="pointer-events-auto relative z-10 hidden h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-ink-4 transition-colors hover:bg-surface-menu-hover hover:text-ink group-hover:flex"
        aria-label={`Rename ${tab.title}`}
      >
        <Pencil className="h-[13px] w-[13px]" strokeWidth={1.5} />
      </button>

      {tab.save_state === "error" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-1.5 top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-destructive"
        />
      ) : null}
    </div>
  );
}
