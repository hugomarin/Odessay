"use client";

import { useEffect, useMemo, useRef, useState, type PointerEventHandler, type ReactNode } from "react";
import { ChevronDown, Eye, FileText, Folder, FolderOpen, Home } from "lucide-react";
import { buildWorkspaceFolderTree } from "@/lib/workspace/folder-tree";
import type { WorkspaceFolderTreeNode } from "@/lib/workspace/folder-tree";
import { startWorkspaceAgentDrag } from "@/components/agent/workspace-agent-drag";
import { WritingStatusIcon } from "@/components/ui/writing-status-icon";
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon";
import { useVocabulary } from "@/hooks/useVocabulary";
import { orderGroupKeysByCatalog } from "@/lib/vocabulary/resolve";
import { getWritingStatusLabel, normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status";
import { getArtifactTypeLabel, normalizeArtifactType, type ArtifactType } from "@/lib/writings/artifact-type";
import {
  WorkspaceFileContextMenu,
  WorkspaceFolderContextMenu,
  type WorkspaceTreeFileActions,
  type WorkspaceTreeFolderActions,
  type WorkspaceTreeFolderNode,
} from "@/components/workspace/workspace-tree-item-menu";
import { cn } from "@/lib/utils";
import { TEXT_FADE_MASK_STYLE } from "@/lib/ui/text-fade-mask";

export type WorkspaceTreeItem = {
  id: string;
  name: string;
  relativePath: string;
  kind: "folder" | "file";
  count?: number;
  openable?: boolean;
  /** Drives the file row's status icon. Undefined/null falls back to a plain document icon. */
  status?: WritingStatus | null;
  /** Drives the file row's icon in "type" grouping. Undefined/null falls back to a plain document icon. */
  artifactType?: ArtifactType | null;
};

const TREE_LABEL_CLASS = "flex-1 overflow-hidden whitespace-nowrap";
const TREE_LABEL_FADE_STYLE = TEXT_FADE_MASK_STYLE;

export type WorkspaceTreeMode = "studio" | "detail";

export type WorkspaceTreeDragPayload = {
  kind: "folder" | "file";
  id?: string;
  path: string;
  label: string;
};

/** "folder" (default) nests by path; "status"/"type" flatten into vocabulary groups instead. */
export type WorkspaceTreeGroupBy = "folder" | "status" | "type";

export type WorkspaceTreeProps = {
  items: WorkspaceTreeItem[];
  mode: WorkspaceTreeMode;
  /** Studio only: groups the flat item list by status/type instead of nesting by folder. */
  groupBy?: WorkspaceTreeGroupBy;
  /** Active document id in Studio or open file id in detail. */
  activeId?: string | null;
  /** Selected folder path in detail mode (`""` for the workspace root). */
  selectedFolderPath?: string | null;
  /** Total file count shown on the root row in detail mode. */
  totalCount?: number;
  /** Label for the workspace root row in detail mode. */
  rootLabel?: string | null;
  /** Icon for the root row: "folder" (default) or "home". */
  rootIcon?: "folder" | "home";
  /** Count of root-level documents shown on the root row. */
  rootCount?: number;
  /** When true, only folders are shown in the tree (no files inside folders). */
  foldersOnly?: boolean;
  onOpenFile?: (id: string) => void;
  /** Shows a hover-revealed eye button on file rows that opens the quick-look preview. */
  onPreviewFile?: (id: string) => void;
  onSelectFolder?: (path: string) => void;
  onDragStart?: (payload: WorkspaceTreeDragPayload) => void;
  onCountChange?: (count?: number) => void;
  emptyState?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  /** Right-click menu on file rows. Omitted entirely when not provided. */
  fileActions?: WorkspaceTreeFileActions;
  /** Right-click menu on folder rows. Omitted entirely when not provided. */
  folderActions?: WorkspaceTreeFolderActions;
};

function totalFileCount(items: WorkspaceTreeItem[]): number {
  return items.filter((item) => item.kind === "file").length;
}

function collectFolderPaths(nodes: WorkspaceFolderTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    paths.push(node.path);
    paths.push(...collectFolderPaths(node.children));
  }
  return paths;
}

/** Flat, depth-annotated folder list for the "Move to" submenu — independent of `groupBy`. */
function flattenFolderNodes(
  nodes: WorkspaceFolderTreeNode[],
  depth: number,
  out: WorkspaceTreeFolderNode[],
): WorkspaceTreeFolderNode[] {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    out.push({ path: node.path, name: node.name, depth });
    flattenFolderNodes(node.children, depth + 1, out);
  }
  return out;
}

/** One file row — shared by the folder tree and the status/type grouped list. */
function FileRow({
  depth,
  id,
  label,
  active,
  disabled,
  icon,
  status,
  artifactType,
  folders,
  fileActions,
  onOpen,
  onPreview,
  onPointerDown,
}: {
  depth: number;
  id: string;
  label: string;
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  status?: WritingStatus | null;
  artifactType?: ArtifactType | null;
  folders?: WorkspaceTreeFolderNode[];
  fileActions?: WorkspaceTreeFileActions;
  onOpen?: () => void;
  onPreview?: () => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const row = (
    <li className="group relative">
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        aria-current={active ? "page" : undefined}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onClick={onOpen}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        className={cn(
          "relative flex h-8 w-full items-center gap-1.5 rounded-[6px] pr-2 text-left text-[11px] text-ink-3 transition-colors",
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
        {icon}
        <span className={TREE_LABEL_CLASS} style={TREE_LABEL_FADE_STYLE}>{label}</span>
      </button>
      {onPreview && !disabled ? (
        <button
          type="button"
          aria-label={`Preview ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onPreview();
          }}
          className="absolute right-1 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[5px] bg-muted text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:flex group-hover:opacity-100"
        >
          <Eye className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>
      ) : null}
    </li>
  );

  if (!fileActions || disabled) return row;

  return (
    <WorkspaceFileContextMenu
      id={id}
      status={status}
      artifactType={artifactType}
      folders={folders ?? []}
      actions={fileActions}
    >
      {row}
    </WorkspaceFileContextMenu>
  );
}

function TreeRow({
  depth,
  node,
  mode,
  activeId,
  selectedFolderPath,
  collapsedPaths,
  idByRelativePath,
  statusByRelativePath,
  artifactTypeByRelativePath,
  foldersOnly,
  folderNodes,
  fileActions,
  folderActions,
  onToggleFolder,
  onOpenFile,
  onPreviewFile,
  onSelectFolder,
  onDragStart,
}: {
  depth: number;
  node: WorkspaceFolderTreeNode;
  mode: WorkspaceTreeMode;
  activeId: string | null;
  selectedFolderPath: string | null;
  collapsedPaths: ReadonlySet<string>;
  idByRelativePath: ReadonlyMap<string, string>;
  statusByRelativePath: ReadonlyMap<string, WritingStatus | null | undefined>;
  artifactTypeByRelativePath: ReadonlyMap<string, ArtifactType | null | undefined>;
  foldersOnly?: boolean;
  folderNodes: WorkspaceTreeFolderNode[];
  fileActions?: WorkspaceTreeFileActions;
  folderActions?: WorkspaceTreeFolderActions;
  onToggleFolder: (path: string) => void;
  onOpenFile?: (id: string) => void;
  onPreviewFile?: (id: string) => void;
  onSelectFolder?: (path: string) => void;
  onDragStart?: (payload: WorkspaceTreeDragPayload) => void;
}) {
  if (node.kind === "file") {
    if (foldersOnly) return null;
    const fileId = idByRelativePath.get(node.path) ?? node.path;
    const active = fileId === activeId;
    const disabled = !onOpenFile || !fileId;
    const status = statusByRelativePath.get(node.path);
    const previewLabel = node.name.replace(/\.md$/i, "");
    return (
      <FileRow
        depth={depth}
        id={fileId}
        label={previewLabel}
        active={active}
        disabled={disabled}
        status={status}
        artifactType={artifactTypeByRelativePath.get(node.path)}
        folders={folderNodes}
        fileActions={fileActions}
        icon={
          status ? (
            <WritingStatusIcon status={status} className="h-[14px] w-[14px] shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          )
        }
        onOpen={() => onOpenFile?.(fileId)}
        onPreview={onPreviewFile ? () => onPreviewFile(fileId) : undefined}
        onPointerDown={onDragStart ? (event) => {
          const payload: WorkspaceTreeDragPayload = {
            kind: "file",
            id: fileId,
            path: node.path,
            label: previewLabel,
          };
          startWorkspaceAgentDrag(event, payload);
          onDragStart(payload);
        } : undefined}
      />
    );
  }

  const expanded = !collapsedPaths.has(node.path);
  const isSelected = mode === "detail" && selectedFolderPath === node.path;
  const folderDisabled = mode === "studio" ? false : !onSelectFolder;
  const hasChildren = foldersOnly
    ? node.children.some((child) => child.kind === "folder")
    : node.children.length > 0;

  const folderRow = (
    <li>
      <button
        type="button"
        role="treeitem"
        data-folder-path={node.path}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={isSelected}
        disabled={folderDisabled}
        onPointerDown={onDragStart ? (event) => {
          const payload: WorkspaceTreeDragPayload = {
            kind: "folder",
            path: node.path,
            label: node.name,
          };
          startWorkspaceAgentDrag(event, payload);
          onDragStart(payload);
        } : undefined}
        onClick={() => {
          if (mode === "detail") {
            onSelectFolder?.(node.path);
          }
          if (hasChildren) onToggleFolder(node.path);
        }}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        className={cn(
          "group flex h-8 w-full items-center gap-1.5 rounded-[6px] pr-2 text-left text-[11px] transition-colors",
          "text-ink-3 hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
          isSelected && "bg-muted text-ink",
        )}
      >
        {hasChildren ? (
          <ChevronDown
            className={cn(
              "h-[13px] w-[13px] shrink-0 text-ink-4 transition-transform duration-[180ms] ease-layout",
              expanded ? "rotate-0" : "-rotate-90",
            )}
            strokeWidth={1.5}
          />
        ) : (
          <span className="h-[13px] w-[13px] shrink-0" aria-hidden="true" />
        )}
        {expanded ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        )}
        <span className={TREE_LABEL_CLASS} style={TREE_LABEL_FADE_STYLE}>{node.name}</span>
        {typeof node.fileCount === "number" ? (
          <span className="font-mono text-[11px] text-ink-4">
            {node.fileCount}
          </span>
        ) : null}
      </button>
      {expanded && hasChildren ? (
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
              statusByRelativePath={statusByRelativePath}
              artifactTypeByRelativePath={artifactTypeByRelativePath}
              foldersOnly={foldersOnly}
              folderNodes={folderNodes}
              fileActions={fileActions}
              folderActions={folderActions}
              onToggleFolder={onToggleFolder}
              onOpenFile={onOpenFile}
              onPreviewFile={onPreviewFile}
              onSelectFolder={onSelectFolder}
              onDragStart={onDragStart}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );

  if (!folderActions) return folderRow;

  return (
    <WorkspaceFolderContextMenu path={node.path} actions={folderActions}>
      {folderRow}
    </WorkspaceFolderContextMenu>
  );
}

export function WorkspaceTree({
  items,
  mode,
  groupBy = "folder",
  activeId,
  selectedFolderPath: selectedFolderPathProp,
  totalCount,
  rootLabel,
  rootIcon = "folder",
  rootCount,
  foldersOnly,
  onOpenFile,
  onPreviewFile,
  onSelectFolder,
  onDragStart,
  onCountChange,
  emptyState,
  className,
  "aria-label": ariaLabel,
  fileActions,
  folderActions,
}: WorkspaceTreeProps) {
  const catalog = useVocabulary();
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
    if (groupBy !== "folder" || items.length === 0) return [];
    return buildWorkspaceFolderTree(
      items.map((item) => ({
        relativePath: item.relativePath,
        name: item.name,
      })),
    );
  }, [items, groupBy]);

  // Independent of `groupBy` — the "Move to" submenu needs every folder even
  // when the tree itself is currently rendering the status/type grouping.
  // Reuses `tree` when it already built the same structure (groupBy ===
  // "folder") instead of running buildWorkspaceFolderTree over every
  // document a second time.
  const folderNodes = useMemo<WorkspaceTreeFolderNode[]>(() => {
    if (items.length === 0) return [{ path: "", name: rootLabel ?? "Workspace root", depth: 0 }];
    const fullTree =
      groupBy === "folder"
        ? tree
        : buildWorkspaceFolderTree(
            items.map((item) => ({ relativePath: item.relativePath, name: item.name })),
          );
    return [
      { path: "", name: rootLabel ?? "Workspace root", depth: 0 },
      ...flattenFolderNodes(fullTree, 1, []),
    ];
  }, [items, rootLabel, groupBy, tree]);

  // Flattens into vocabulary groups instead of folders — "status" shows each
  // file's artifact type (the group header already names its status) and
  // vice versa for "type", the same swap Desk's grouped table does.
  const groupedSections = useMemo(() => {
    if (groupBy === "folder") return [];
    const kind = groupBy === "status" ? "status" : "type";
    const normalize = groupBy === "status" ? normalizeWritingStatus : normalizeArtifactType;
    const label = groupBy === "status" ? getWritingStatusLabel : getArtifactTypeLabel;
    const buckets = new Map<string, WorkspaceTreeItem[]>();
    for (const item of items) {
      if (item.kind !== "file") continue;
      const key = normalize(groupBy === "status" ? item.status : item.artifactType);
      const bucket = buckets.get(key) ?? [];
      bucket.push(item);
      buckets.set(key, bucket);
    }
    return orderGroupKeysByCatalog(catalog, kind, buckets.keys()).map((key) => ({
      key,
      label: label(key),
      items: buckets.get(key) ?? [],
    }));
  }, [items, groupBy, catalog]);

  // Studio's Workspace tab opens collapsed rather than fully expanded — but
  // only on the tree's first real load. Once seeded, later rebuilds (an
  // autosave patch, or switching to another document in the same Workspace,
  // both of which replace `items` without remounting this component) must
  // not re-collapse whatever the author has since opened.
  const hasSeededCollapse = useRef(false);
  useEffect(() => {
    if (mode !== "studio" || hasSeededCollapse.current || tree.length === 0) return;
    hasSeededCollapse.current = true;
    setCollapsedPaths(new Set(collectFolderPaths(tree)));
  }, [mode, tree]);

  const idByRelativePath = useMemo(
    () => new Map(items.map((item) => [item.relativePath, item.id])),
    [items],
  );

  const statusByRelativePath = useMemo(
    () => new Map(items.map((item) => [item.relativePath, item.status])),
    [items],
  );

  const artifactTypeByRelativePath = useMemo(
    () => new Map(items.map((item) => [item.relativePath, item.artifactType])),
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
      {rootLabel ? (
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
              {rootIcon === "home" ? (
                <Home className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              )}
              <span className={TREE_LABEL_CLASS} style={TREE_LABEL_FADE_STYLE}>{rootLabel}</span>
              {typeof rootCount === "number" ? (
                <span className="font-mono text-[11px] text-ink-4">
                  {rootCount}
                </span>
              ) : typeof totalCount === "number" ? (
                <span className="font-mono text-[11px] text-ink-4">
                  {totalCount}
                </span>
              ) : null}
            </button>
          </li>
        </ul>
      ) : null}
      {groupBy === "folder" ? (
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
              statusByRelativePath={statusByRelativePath}
              artifactTypeByRelativePath={artifactTypeByRelativePath}
              foldersOnly={foldersOnly}
              folderNodes={folderNodes}
              fileActions={fileActions}
              folderActions={folderActions}
              onToggleFolder={handleToggleFolder}
              onOpenFile={onOpenFile}
              onPreviewFile={onPreviewFile}
            onSelectFolder={onSelectFolder}
            onDragStart={onDragStart}
            />
          ))}
        </ul>
      ) : (
        <ul>
          {groupedSections.map((section) => {
            const groupPath = `group:${groupBy}:${section.key}`;
            const expanded = !collapsedPaths.has(groupPath);
            const hasItems = section.items.length > 0;
            return (
              <li key={groupPath}>
                <button
                  type="button"
                  role="treeitem"
                  data-folder-path={groupPath}
                  aria-expanded={hasItems ? expanded : undefined}
                  onClick={() => hasItems && handleToggleFolder(groupPath)}
                  disabled={!hasItems}
                  className={cn(
                    "flex h-8 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-[11px] transition-colors",
                    "text-ink-3 hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <ChevronDown
                    className={cn(
                      "h-[13px] w-[13px] shrink-0 text-ink-4 transition-transform duration-[180ms] ease-layout",
                      hasItems ? (expanded ? "rotate-0" : "-rotate-90") : "opacity-0",
                    )}
                    strokeWidth={1.5}
                  />
                  {groupBy === "status" ? (
                    <WritingStatusIcon status={section.key} className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ArtifactTypeIcon artifactType={section.key} className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className={TREE_LABEL_CLASS} style={TREE_LABEL_FADE_STYLE}>{section.label}</span>
                  <span className="font-mono text-[11px] text-ink-4">{section.items.length}</span>
                </button>
                {expanded && hasItems ? (
                  <ul>
                    {section.items.map((item) => {
                      const active = item.id === activeId;
                      const disabled = !onOpenFile || !item.id;
                      return (
                        <FileRow
                          key={item.id || item.relativePath}
                          depth={1}
                          id={item.id}
                          label={item.name.replace(/\.md$/i, "")}
                          active={active}
                          disabled={disabled}
                          status={item.status}
                          artifactType={item.artifactType}
                          folders={folderNodes}
                          fileActions={fileActions}
                          icon={
                            groupBy === "status" ? (
                              item.artifactType ? (
                                <ArtifactTypeIcon artifactType={item.artifactType} className="h-[14px] w-[14px] shrink-0" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                              )
                            ) : item.status ? (
                              <WritingStatusIcon status={item.status} className="h-[14px] w-[14px] shrink-0" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                            )
                          }
                          onOpen={() => onOpenFile?.(item.id)}
                          onPreview={onPreviewFile ? () => onPreviewFile(item.id) : undefined}
                        />
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
