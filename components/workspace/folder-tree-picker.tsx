"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Crosshair, FileText, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  collectDescendantFilePaths,
  getNodeSelectionState,
  toggleWorkspaceNodeSelection,
  type WorkspaceFolderTreeNode,
} from "@/lib/workspace/folder-tree";

type Props = {
  tree: WorkspaceFolderTreeNode[];
  selectedFiles: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  query?: string;
  autoExpandAll?: boolean;
};

function Checkbox({
  state,
  label,
  onChange,
}: {
  state: "checked" | "partial" | "unchecked";
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "partial";
  }, [state]);
  return (
    <label className="inline-flex h-5 w-5 items-center justify-center">
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        type="checkbox"
        checked={state === "checked"}
        onChange={onChange}
        className="peer sr-only"
      />
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] border-[0.5px] border-border bg-sb peer-focus-visible:outline">
        {state === "checked" ? (
          <Check className="h-3 w-3" strokeWidth={2} />
        ) : state === "partial" ? (
          <span className="h-[1.5px] w-[9px] bg-ink" />
        ) : null}
      </span>
    </label>
  );
}

function matches(node: WorkspaceFolderTreeNode, query: string): boolean {
  return (
    !query ||
    node.name.toLowerCase().includes(query) ||
    node.children.some((child) => matches(child, query))
  );
}

function Row({
  node,
  depth,
  selected,
  onChange,
  query,
}: {
  node: WorkspaceFolderTreeNode;
  depth: number;
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  query: string;
}) {
  const [manuallyExpanded, setExpanded] = useState(depth < 1);
  const expanded = query ? matches(node, query) : manuallyExpanded;
  if (!matches(node, query)) return null;
  const folder = node.kind === "folder";
  return (
    <li>
      <div
        className="group grid h-[38px] grid-cols-[16px_20px_16px_1fr_auto_auto] items-center gap-2 rounded-[8px] pr-2 hover:bg-muted/50"
        style={{ paddingLeft: `${8 + depth * 18}px` }}
      >
        {folder ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={
              expanded ? `Collapse ${node.name}` : `Expand ${node.name}`
            }
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-[180ms]",
                expanded && "rotate-90",
              )}
              strokeWidth={1.5}
            />
          </button>
        ) : (
          <span />
        )}
        <Checkbox
          state={getNodeSelectionState(node, selected)}
          label={`Include ${node.name}`}
          onChange={() =>
            onChange(toggleWorkspaceNodeSelection(node, selected))
          }
        />
        {folder ? (
          <Folder className="h-4 w-4" strokeWidth={1.5} />
        ) : (
          <FileText className="h-4 w-4" strokeWidth={1.5} />
        )}
        <span className="truncate text-[13px]">{node.name}</span>
        <span className="font-mono text-[11px] text-ink-4">
          {folder ? node.fileCount : ""}
        </span>
        <button
          type="button"
          onClick={() => onChange(new Set(collectDescendantFilePaths(node)))}
          className="flex h-6 items-center gap-1 text-[11px] text-ink/55 opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100"
        >
          <Crosshair className="h-3 w-3" strokeWidth={1.5} />
          Only this
        </button>
      </div>
      {folder && expanded ? (
        <ul>
          {node.children.map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onChange={onChange}
              query={query}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTreePicker({
  tree,
  selectedFiles,
  onChange,
  query = "",
}: Props) {
  if (!tree.length)
    return (
      <div className="rounded-[12px] border-[0.5px] border-dashed border-border px-5 py-6 text-sm text-ink-3">
        This folder does not contain any eligible `.md` or `.mdx` files yet.
      </div>
    );
  const normalized = query.trim().toLowerCase();
  return (
    <div role="tree" aria-label="Workspace files">
      <ul>
        {tree.map((node) => (
          <Row
            key={node.path}
            node={node}
            depth={0}
            selected={selectedFiles}
            onChange={onChange}
            query={normalized}
          />
        ))}
      </ul>
    </div>
  );
}
