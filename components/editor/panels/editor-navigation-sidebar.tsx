"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Left panel — 236px (`--size-panel-left`), transparent on layer 0, in flow so
 * the sheet is never underneath it (docs/design/layout.md §2). One 46px header
 * row carries the two mode pills and the close button. The prototype's second
 * row — title plus count badge — is gone: the pills already name the mode, so
 * the heading framed the tree without adding anything (owner review).
 */

export type EditorNavigationMode = "toc" | "workspace" | null;

type Props = {
  mode: EditorNavigationMode;
  title: string;
  controls: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export function EditorNavigationSidebar({
  mode,
  title,
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
      {/* One header row: the two mode pills, then the close button pushed to the
          far edge. The old title row is gone — with a pill already reading
          "Workspace", a heading repeating it framed the tree without naming
          anything the pills did not (owner review, this pass). */}
      <div className="flex h-[46px] shrink-0 items-center gap-1">
        {controls}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="ml-auto inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted-hover hover:text-ink"
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
