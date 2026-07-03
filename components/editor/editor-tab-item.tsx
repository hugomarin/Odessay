"use client"

import { Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";
import type { DragEventHandler } from "react";

type EditorTabItemProps = {
  tab: LocalEditorSessionTab;
  active: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string) => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDragTarget?: boolean;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
  widthStyle?: string;
};

export function EditorTabItem({
  tab,
  active,
  onSelect,
  onClose,
  onRename,
  draggable = false,
  isDragging = false,
  isDragTarget = false,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
  widthStyle,
}: EditorTabItemProps) {
  return (
    <div
      style={widthStyle ? { width: widthStyle } : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-editor-tab-id={tab.id}
      className={cn(
        "group relative flex h-[46px] min-w-[72px] max-w-[240px] shrink-0 items-center overflow-hidden rounded-t-[10px] border border-b-0 border-transparent text-left font-sans transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out",
        active
          ? "translate-y-px border-transparent bg-bg text-ink shadow-[0_-3px_8px_rgba(35,24,15,0.035),0_12px_22px_rgba(35,24,15,0.05),0_2px_6px_rgba(35,24,15,0.04)]"
          : "bg-transparent text-ink-4 hover:bg-muted/80 hover:text-ink-3",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-45",
        isDragTarget && "ring-1 ring-inset ring-cursor/40",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(tab.id)}
        className="absolute inset-0 z-0 rounded-t-[10px]"
        aria-pressed={active}
        aria-label={`Open ${tab.title}`}
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2 px-4">
        <span className={cn("block min-w-0 flex-1 truncate text-[14px] font-normal leading-none tracking-[-0.01em]", active ? "text-ink" : "text-inherit")}>
          {tab.title}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => {
              onRename(tab.id);
            }}
            data-tab-action="true"
            className="pointer-events-auto inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-[background-color,color] duration-100 ease-out hover:bg-muted hover:text-ink"
            aria-label={`Rename ${tab.title}`}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.4} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            onClose(tab.id);
          }}
          data-tab-action="true"
          className={cn(
            "pointer-events-auto inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-ink-4 opacity-0 transition-[opacity,background-color,color] duration-100 ease-out hover:bg-muted hover:text-ink group-hover:opacity-100",
            active && "opacity-100",
          )}
          aria-label={`Close ${tab.title}`}
        >
          <X className="h-4 w-4" strokeWidth={1.4} />
        </button>
      </div>
      {active ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[8px] bottom-[-1px] h-[3px] rounded-full bg-bg"
        />
      ) : null}
      {tab.save_state === "error" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-8 top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-destructive"
        />
      ) : null}
    </div>
  );
}
