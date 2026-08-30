"use client";

import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents";
import { FolderTree, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EditorNavigationSidebar,
  NavigationModeButton,
  type EditorNavigationMode,
} from "./editor-navigation-sidebar";
import { WorkspaceTreePanel } from "./workspace-tree-panel";

type Props = {
  items: TableOfContentDataItem[];
  activeItemId: string | null;
  onNavigate: (item: TableOfContentDataItem) => void;
  activeWritingId: string | null;
  onOpenDocument: (id: string) => Promise<void>;
  mode: EditorNavigationMode;
  onModeChange: (mode: EditorNavigationMode) => void;
};

// Indent read from the Studio prototype: level<=1 -> 8px, level 2 -> 24px,
// level 3+ -> 40px.
const indent = (level: number) =>
  level <= 1 ? "pl-2" : level === 2 ? "pl-6" : "pl-10";

export function TableOfContentsPanel({
  items,
  activeItemId,
  onNavigate,
  activeWritingId,
  onOpenDocument,
  mode,
  onModeChange,
}: Props) {
  const visibleActiveId =
    activeItemId ?? items.find((item) => item.isActive)?.id ?? null;
  const controls = (
    <>
      <NavigationModeButton
        active={mode === "toc"}
        label="TOC"
        onClick={() => onModeChange(mode === "toc" ? null : "toc")}
      >
        <ListTree className="h-4 w-4" strokeWidth={1.5} />
      </NavigationModeButton>
      <NavigationModeButton
        active={mode === "workspace"}
        label="Workspace"
        onClick={() => onModeChange(mode === "workspace" ? null : "workspace")}
      >
        <FolderTree className="h-4 w-4" strokeWidth={1.5} />
      </NavigationModeButton>
    </>
  );

  return (
    <EditorNavigationSidebar
      mode={mode}
      title={mode === "workspace" ? "Workspace" : "Contents"}
      controls={controls}
      onClose={() => onModeChange(null)}
    >
      {mode === "toc" ? (
        items.length === 0 ? (
          <p className="px-2 py-3 font-lora text-[12px] italic text-ink-4">
            No sections yet.
          </p>
        ) : (
          <nav aria-label="Artifact sections">
            <ul className="space-y-px">
              {items.map((item) => {
                const active = item.id === visibleActiveId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item)}
                      aria-current={active ? "location" : undefined}
                      className={cn(
                        "relative flex min-h-7 w-full items-center rounded-[6px] py-1 pr-2 text-left text-[12px] leading-[1.35] text-ink-3 hover:bg-line-soft hover:text-ink",
                        indent(item.level),
                        active &&
                          "bg-muted-hover text-ink before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-cursor",
                      )}
                    >
                      <span
                        className={cn(
                          "truncate",
                          item.originalLevel <= 1 && "font-medium",
                        )}
                      >
                        {item.textContent}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )
      ) : mode === "workspace" ? (
        <WorkspaceTreePanel
          activeWritingId={activeWritingId}
          onOpenDocument={onOpenDocument}
        />
      ) : null}
    </EditorNavigationSidebar>
  );
}
