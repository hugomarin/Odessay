"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Left panel — 236px (`--size-panel-left`), transparent on layer 0, in flow so
 * the sheet is never underneath it (docs/design/layout.md §2). Its two header
 * rows follow the Studio prototype: a 46px tab row, then a 40px title row with
 * the count badge and the close button.
 */

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
    <aside
      data-testid="editor-navigation-sidebar"
      data-open={mode ? "true" : "false"}
      className={cn(
        "EditorNavigationSidebar flex shrink-0 flex-col overflow-hidden bg-transparent font-sans transition-[width,opacity,padding] duration-[300ms] ease-layout",
        mode
          ? "w-[var(--size-panel-left)] pb-1.5 pl-1.5 pr-3.5 opacity-100"
          : "pointer-events-none w-0 p-0 opacity-0",
      )}
    >
      <div className="flex h-[46px] shrink-0 items-center gap-1">{controls}</div>

      <div className="flex h-10 shrink-0 items-center gap-2 border-y-[0.5px] border-border pl-1 pr-0.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</span>
        {typeof count === "number" ? (
          <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-[10px] bg-muted-hover px-[7px] text-[11px] font-medium text-ink-3">
            {count}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted-hover hover:text-ink"
        >
          <X className="h-[15px] w-[15px]" strokeWidth={1.5} />
        </button>
      </div>

      {/* `overscroll-contain` keeps a wheel gesture over the tree from
          chaining to the shell once the list hits its end. */}
      <div className="od-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-2 pr-0.5">
        {children}
      </div>
    </aside>
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
        "flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] transition-colors",
        active ? "bg-surface-selected text-ink" : "text-ink-3 hover:bg-muted-hover hover:text-ink",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
