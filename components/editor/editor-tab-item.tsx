"use client"

import { Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";

type EditorTabItemProps = {
  tab: LocalEditorSessionTab;
  active: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string) => void;
  widthStyle?: string;
};

export function EditorTabItem({ tab, active, onSelect, onClose, onRename, widthStyle }: EditorTabItemProps) {
  return (
    <div
      style={widthStyle ? { width: widthStyle } : undefined}
      className={cn(
        "group relative flex h-10 min-w-[72px] max-w-[240px] shrink-0 items-center overflow-hidden rounded-t-[12px] border border-b-0 border-transparent text-left font-sans transition-[background-color,border-color,color] duration-150 ease-out",
        active
          ? "translate-y-px border-border/90 bg-bg text-ink"
          : "bg-transparent text-ink-4 hover:bg-muted/80 hover:text-ink-3",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(tab.id)}
        className="absolute inset-0 z-0 rounded-t-[12px]"
        aria-pressed={active}
        aria-label={`Open ${tab.title}`}
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2 px-3.5">
        <span className={cn("block min-w-0 flex-1 truncate text-[14px] font-normal leading-none tracking-[-0.01em]", active ? "text-ink" : "text-inherit")}>
          {tab.title}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => {
              onRename(tab.id);
            }}
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
          className="pointer-events-none absolute inset-x-[10px] bottom-[-1px] h-[2px] bg-bg"
        />
      ) : null}
      {tab.save_state === "error" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-8 top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-destructive"
        />
      ) : null}
      {tab.has_pending_sync && !active ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-[9px] left-0 w-px bg-cursor/45 opacity-80"
        />
      ) : null}
    </div>
  );
}
