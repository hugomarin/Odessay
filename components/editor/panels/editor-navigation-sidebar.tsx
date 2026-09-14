"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Left panel — drag-resizable between MIN/MAX_PANEL_WIDTH, defaulting to the
 * old fixed 236px (`--size-panel-left`, now only the fallback/first-paint
 * value) — transparent on layer 0, in flow so the sheet is never underneath
 * it (docs/design/layout.md §2). One 46px header row carries the two mode
 * pills and the close button. The prototype's second row — title plus count
 * badge — is gone: the pills already name the mode, so the heading framed
 * the tree without adding anything (owner review).
 */

const PANEL_WIDTH_STORAGE_KEY = "od:editor-nav-panel-width";
const DEFAULT_PANEL_WIDTH = 236;
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 420;

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

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
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) setWidth(clampPanelWidth(stored));
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampPanelWidth(drag.startWidth + (event.clientX - drag.startX)));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
    document.body.style.removeProperty("user-select");
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    setWidth((current) => {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(current));
      return current;
    });
  }, [handlePointerMove]);

  // Belt-and-suspenders unmount cleanup — a drag that ends by the panel
  // closing (Escape, clicking away) still needs these off the window.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handlePointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    setIsResizing(true);
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <aside
      data-testid="editor-navigation-sidebar"
      data-open={mode ? "true" : "false"}
      style={mode ? { width } : undefined}
      className={cn(
        "EditorNavigationSidebar relative flex shrink-0 flex-col overflow-hidden bg-transparent font-sans",
        !isResizing && "transition-[width,opacity,padding] duration-[300ms] ease-layout",
        mode
          ? "pb-1.5 pl-1.5 pr-3.5 opacity-100"
          : "pointer-events-none w-0 p-0 opacity-0",
      )}
    >
      {/* One header row: the two mode pills, then the close button pushed to the
          far edge. The old title row is gone — with a pill already reading
          "Workspace", a heading repeating it framed the tree without naming
          anything the pills did not (owner review, this pass). */}
      <div className="mt-1.5 flex h-[46px] shrink-0 items-center gap-1">
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

      {mode ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${title}`}
          aria-valuenow={width}
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={MAX_PANEL_WIDTH}
          onPointerDown={handlePointerDown}
          onDoubleClick={() => {
            setWidth(DEFAULT_PANEL_WIDTH);
            window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(DEFAULT_PANEL_WIDTH));
          }}
          className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none"
        >
          <div
            className={cn(
              "mx-auto h-full w-px bg-transparent transition-colors",
              isResizing ? "bg-cursor" : "hover:bg-border",
            )}
          />
        </div>
      ) : null}
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
