"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileText, Folder } from "lucide-react";
import { buildWorkspaceFolderTree } from "@/lib/workspace/folder-tree";
import type { WorkspaceFolderTreeNode } from "@/lib/workspace/folder-tree";
import { cn } from "@/lib/utils";

export type WorkspaceTreeItem = {
  id: string;
  name: string;
  relativePath: string;
  kind: "folder" | "file";
  count?: number;
  openable?: boolean;
};

export type WorkspaceTreeMode = "studio" | "detail";

export type WorkspaceTreeProps = {
  items: WorkspaceTreeItem[];
  mode: WorkspaceTreeMode;
  /** Active document id in Studio or open file id in detail. */
  activeId?: string | null;
  /** Selected folder path in detail mode (`""` for the workspace root). */
  selectedFolderPath?: string | null;
  /** Total file count shown on the root row in detail mode. */
  totalCount?: number;
  /** Label for the workspace root row in detail mode. */
  rootLabel?: string | null;
  onOpenFile?: (id: string) => void;
  onSelectFolder?: (path: string) => void;
  onCountChange?: (count?: number) => void;
  emptyState?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
};

function totalFileCount(items: WorkspaceTreeItem[]): number {
  return items.filter((item) => item.kind === "file").length;
}

function TreeRow({
  depth,
  node,
  mode,
  activeId,
  selectedFolderPath,
  collapsedPaths,
  idByRelativePath,
  onToggleFolder,
  onOpenFile,
  onSelectFolder,
}: {
  depth: number;
  node: WorkspaceFolderTreeNode;
  mode: WorkspaceTreeMode;
  activeId: string | null;
  selectedFolderPath: string | null;
  collapsedPaths: ReadonlySet<string>;
  idByRelativePath: ReadonlyMap<string, string>;
  onToggleFolder: (path: string) => void;
  onOpenFile?: (id: string) => void;
  onSelectFolder?: (path: string) => void;
}) {
  if (node.kind === "file") {
    const fileId = idByRelativePath.get(node.path) ?? node.path;
    const active = fileId === activeId;
    const disabled = !onOpenFile || !fileId;
    return (
      <li>
        <button
          type="button"
          role="treeitem"
          aria-selected={active}
          aria-current={active ? "page" : undefined}
          disabled={disabled}
          onClick={() => onOpenFile?.(fileId)}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          className={cn(
            "group relative flex h-8 w-full items-center gap-1.5 rounded-[6px] pr-2 text-left text-[11px] text-ink-3 transition-colors",
            "hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
            active && "bg-muted text-ink",
          )}
        >
          {active ? (
            <span
              className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-cursor"
              aria-hidden="true"
            />
          ) : null}
          <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span className="flex-1 truncate">
            {node.name.replace(/\.md$/i, "")}
          </span>
        </button>
      </li>
    );
  }

  const expanded = !collapsedPaths.has(node.path);
  const isSelected = mode === "detail" && selectedFolderPath === node.path;
  const folderDisabled = mode === "studio" ? false : !onSelectFolder;

  return (
    <li>
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        aria-selected={isSelected}
        disabled={folderDisabled}
        onClick={() => {
          if (mode === "detail") {
            onSelectFolder?.(node.path);
          }
          onToggleFolder(node.path);
        }}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        className={cn(
          "group flex h-8 w-full items-center gap-1.5 rounded-[6px] pr-2 text-left text-[11px] transition-colors",
          "text-ink-3 hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
          isSelected && "bg-muted text-ink",
        )}
      >
        <ChevronDown
          className={cn(
            "h-[13px] w-[13px] shrink-0 text-ink-4 transition-transform duration-[180ms] ease-layout",
            expanded ? "rotate-0" : "-rotate-90",
          )}
          strokeWidth={1.5}
        />
        <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="flex-1 truncate">{node.name}</span>
        {typeof node.fileCount === "number" ? (
          <span className="font-mono text-[11px] text-ink-4">
            {node.fileCount}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              depth={depth + 1}
              node={child}
              mode={mode}
              activeId={activeId}
              selectedFolderPath={selectedFolderPath}
              collapsedPaths={collapsedPaths}
              idByRelativePath={idByRelativePath}
              onToggleFolder={onToggleFolder}
              onOpenFile={onOpenFile}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function WorkspaceTree({
  items,
  mode,
  activeId,
  selectedFolderPath: selectedFolderPathProp,
  totalCount,
  rootLabel,
  onOpenFile,
  onSelectFolder,
  onCountChange,
  emptyState,
  className,
  "aria-label": ariaLabel,
}: WorkspaceTreeProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(
    mode === "detail" ? "" : null,
  );

  const effectiveSelectedFolder =
    selectedFolderPathProp !== undefined
      ? selectedFolderPathProp
      : selectedFolderPath;

  const tree = useMemo(() => {
    if (items.length === 0) return [];
    return buildWorkspaceFolderTree(
      items.map((item) => ({
        relativePath: item.relativePath,
        name: item.name,
      })),
    );
  }, [items]);

  const idByRelativePath = useMemo(
    () => new Map(items.map((item) => [item.relativePath, item.id])),
    [items],
  );

  const fileCount = useMemo(() => totalFileCount(items), [items]);

  useEffect(() => {
    onCountChange?.(fileCount);
  }, [fileCount, onCountChange]);

  const handleToggleFolder = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSelectRoot = () => {
    if (selectedFolderPathProp === undefined) {
      setSelectedFolderPath("");
    }
    onSelectFolder?.("");
  };

  if (items.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      className={cn("outline-none", className)}
      onKeyDown={(event) => {
        const treeElement = event.currentTarget;
        const items = Array.from(
          treeElement.querySelectorAll<HTMLButtonElement>(
            '[role="treeitem"]:not(:disabled)',
          ),
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );

        if (event.key === "ArrowDown") {
          const next = Math.min(items.length - 1, index + 1);
          if (items[next]) {
            event.preventDefault();
            items[next].focus();
          }
          return;
        }

        if (event.key === "ArrowUp") {
          const next = Math.max(0, index - 1);
          if (items[next]) {
            event.preventDefault();
            items[next].focus();
          }
          return;
        }

        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          const active = items[index];
          if (!active) return;
          const path = active.getAttribute("data-folder-path");
          if (!path) return;
          const expanded = !collapsedPaths.has(path);
          if (event.key === "ArrowRight" && !expanded) {
            event.preventDefault();
            handleToggleFolder(path);
          } else if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            handleToggleFolder(path);
          }
        }
      }}
    >
      {mode === "detail" && rootLabel ? (
        <ul>
          <li>
            <button
              type="button"
              role="treeitem"
              aria-selected={effectiveSelectedFolder === ""}
              onClick={handleSelectRoot}
              className={cn(
                "flex h-8 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-[11px] transition-colors",
                "text-ink-3 hover:bg-muted hover:text-ink",
                effectiveSelectedFolder === "" && "bg-muted text-ink",
              )}
            >
              <span
                className="invisible h-[13px] w-[13px] shrink-0"
                aria-hidden="true"
              >
                <ChevronDown className="h-[13px] w-[13px]" strokeWidth={1.5} />
              </span>
              <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="flex-1 truncate">{rootLabel}</span>
              {typeof totalCount === "number" ? (
                <span className="font-mono text-[11px] text-ink-4">
                  {totalCount}
                </span>
              ) : null}
            </button>
          </li>
        </ul>
      ) : null}
      <ul>
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            depth={0}
            node={node}
            mode={mode}
            activeId={activeId ?? null}
            selectedFolderPath={effectiveSelectedFolder}
            collapsedPaths={collapsedPaths}
            idByRelativePath={idByRelativePath}
            onToggleFolder={handleToggleFolder}
            onOpenFile={onOpenFile}
            onSelectFolder={onSelectFolder}
          />
        ))}
      </ul>
    </div>
  );
}
