"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type EditorNavigationMode = "toc" | "workspace" | null;

type Props = {
  mode: EditorNavigationMode;
  title: string;
  count?: number;
  controls: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export function EditorNavigationSidebar({
  mode,
  title,
  count,
  controls,
  children,
  onClose,
}: Props) {
  return (
    <div
      className="absolute inset-y-0 left-0 z-20 flex font-sans"
      data-testid="editor-navigation-sidebar"
    >
      {mode ? (
        <aside className="flex h-full w-64 flex-col border-r-[0.5px] border-border bg-sb">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border px-3">
            {controls}
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-3">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
              {title}
            </span>
            {typeof count === "number" ? (
              <span className="rounded-full bg-muted px-1.5 text-[9px] text-ink-3">
                {count}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-4 hover:bg-muted hover:text-ink"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
        </aside>
      ) : (
        <div className="flex h-11 items-center gap-1 px-3">{controls}</div>
      )}
    </div>
  );
}

export function NavigationModeButton({
  active,
  label,
  children,
  onClick,
}: {
  active: boolean;
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[10px] text-ink-3 transition-colors hover:bg-muted hover:text-ink",
        active && "bg-muted text-ink",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
