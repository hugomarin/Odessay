"use client"

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalEditorSessionTab } from "@/lib/local-db/schema";

type EditorTabItemProps = {
  tab: LocalEditorSessionTab;
  active: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
};

const STATUS_LABELS: Record<LocalEditorSessionTab["save_state"], string> = {
  saved: "Saved",
  saving: "Saving...",
  "saved-local": "Saved",
  error: "Error",
};

export function EditorTabItem({ tab, active, onSelect, onClose }: EditorTabItemProps) {
  return (
    <div
      className={cn(
        "group flex h-full min-w-[64px] flex-1 items-center gap-2 border-r-[0.5px] border-border/80 px-3 text-left transition-colors",
        active ? "bg-bg text-ink" : "bg-transparent text-ink-4 hover:bg-muted/80 hover:text-ink",
      )}
    >
      <button type="button" onClick={() => onSelect(tab.id)} className="min-w-0 flex-1 text-left">
        <span className="block truncate font-lora text-[13px] leading-none">{tab.title}</span>
      </button>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-ink-4">{STATUS_LABELS[tab.save_state]}</span>
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            "h-[6px] w-[6px] rounded-full bg-cursor transition-opacity",
            tab.has_pending_sync ? "opacity-100 group-hover:opacity-0" : "opacity-0",
          )}
        />
        <button
          type="button"
          onClick={() => {
            onClose(tab.id);
          }}
          className="absolute inset-0 inline-flex items-center justify-center rounded-[4px] text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
          role="button"
          aria-label={`Close ${tab.title}`}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </span>
    </div>
  );
}
