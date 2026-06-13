"use client"

import { useMemo, useRef, useState } from "react"
import { Check, ChevronRight, FileText, Folder } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getNodeSelectionState,
  toggleWorkspaceNodeSelection,
  type WorkspaceFolderSelectionState,
  type WorkspaceFolderTreeNode,
} from "@/lib/workspace/folder-tree"

type FolderTreePickerProps = {
  tree: WorkspaceFolderTreeNode[]
  selectedFiles: ReadonlySet<string>
  onChange: (nextSelectedFiles: Set<string>) => void
  autoExpandAll?: boolean
}

function FolderTreeCheckbox({
  state,
  onToggle,
}: {
  state: WorkspaceFolderSelectionState
  onToggle: () => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)

  if (ref.current) {
    ref.current.indeterminate = state === "partial"
  }

  return (
    <label className="inline-flex h-5 w-5 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={state === "checked"}
        onChange={onToggle}
        className="peer sr-only"
      />
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] border border-border bg-sb text-ink transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
        {state === "checked" ? <Check className="h-3 w-3" strokeWidth={2.2} /> : state === "partial" ? <span className="h-[2px] w-2 rounded-full bg-ink" /> : null}
      </span>
    </label>
  )
}

function FolderTreeNodeRow({
  node,
  depth,
  selectedFiles,
  onChange,
  autoExpandAll,
}: {
  node: WorkspaceFolderTreeNode
  depth: number
  selectedFiles: ReadonlySet<string>
  onChange: (nextSelectedFiles: Set<string>) => void
  autoExpandAll: boolean
}) {
  const isFolder = node.kind === "folder"
  const [isExpanded, setIsExpanded] = useState(autoExpandAll || depth < 1)
  const selectionState = getNodeSelectionState(node, selectedFiles)

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-muted/40"
        style={{ paddingLeft: `${8 + depth * 18}px` }}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={() => setIsExpanded((currentState) => !currentState)}
            className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", isExpanded ? "rotate-90" : "")}
              strokeWidth={1.5}
            />
          </button>
        ) : (
          <span className="inline-flex h-5 w-5" />
        )}

        <FolderTreeCheckbox
          state={selectionState}
          onToggle={() => onChange(toggleWorkspaceNodeSelection(node, selectedFiles))}
        />

        <div className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-border bg-bg text-ink-3">
          {isFolder ? <Folder className="h-4 w-4" strokeWidth={1.5} /> : <FileText className="h-4 w-4" strokeWidth={1.5} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-ink">{node.name}</div>
          <div className="text-[12px] text-ink-4">
            {isFolder ? `${node.fileCount} markdown file${node.fileCount === 1 ? "" : "s"}` : "Markdown file"}
          </div>
        </div>
      </div>

      {isFolder && isExpanded ? (
        <div className="mt-1">
          {node.children.map((child) => (
            <FolderTreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFiles={selectedFiles}
              onChange={onChange}
              autoExpandAll={autoExpandAll}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function FolderTreePicker({
  tree,
  selectedFiles,
  onChange,
  autoExpandAll = false,
}: FolderTreePickerProps) {
  const selectedCount = selectedFiles.size
  const totalCount = useMemo(
    () => tree.reduce((total, node) => total + node.fileCount, 0),
    [tree],
  )

  if (tree.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-border bg-bg px-5 py-6 text-sm leading-7 text-ink-3">
        This folder does not contain any eligible `.md` or `.mdx` files yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-[16px] border border-border bg-bg px-4 py-3 text-sm text-ink-3">
        <span>{totalCount} markdown files available</span>
        <span>{selectedCount} selected</span>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-[18px] border border-border bg-sb px-3 py-3">
        <div className="space-y-1">
          {tree.map((node) => (
            <FolderTreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              selectedFiles={selectedFiles}
              onChange={onChange}
              autoExpandAll={autoExpandAll}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
