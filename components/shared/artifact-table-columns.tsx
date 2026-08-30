"use client"

import { Clipboard, ExternalLink, MoreHorizontal, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { WritingStatusBadge } from "@/components/ui/writing-status-badge"
import { getArtifactTypeLabel } from "@/lib/writings/artifact-type"
import type {
  ArtifactAction,
  ArtifactColumnId,
  ArtifactTableColumn,
  ArtifactTableItem,
} from "@/components/shared/artifact-table-types"

const ACTION_CONFIG: Record<ArtifactAction, { label: string; icon: typeof ExternalLink }> = {
  open: { label: "Open", icon: ExternalLink },
  copy: { label: "Copy", icon: Clipboard },
  delete: { label: "Delete", icon: Trash2 },
}

type StandardColumnOptions = {
  /** Which actions the `actions` column should surface, in order. */
  actions?: ArtifactAction[]
  onActionClick?: (action: ArtifactAction, item: ArtifactTableItem) => void
}

function renderTitle(item: ArtifactTableItem) {
  return (
    <div
      style={{
        WebkitMaskImage: "linear-gradient(90deg, #000 86%, transparent)",
        maskImage: "linear-gradient(90deg, #000 86%, transparent)",
      }}
    >
      <p className="truncate font-lora text-[15px] font-medium leading-[1.3] text-ink">{item.title}</p>
      {item.excerpt ? <p className="truncate pt-1 text-[12px] text-ink-3">{item.excerpt}</p> : null}
    </div>
  )
}

/**
 * Builds the canonical spec columns (`title`, `workspace`, `artifactType`,
 * `status`, `date`, `actions`) for the simple `ArtifactTableItem` shape. Surfaces
 * that need richer cells (Desk's status dropdown, collections, recipients) define
 * their own columns instead — both paths feed the same `ArtifactTable` engine.
 */
export function createArtifactColumns(
  columns: ArtifactColumnId[],
  options: StandardColumnOptions = {},
): ArtifactTableColumn<ArtifactTableItem>[] {
  const { actions = ["open"], onActionClick } = options

  return columns.map((id): ArtifactTableColumn<ArtifactTableItem> => {
    switch (id) {
      case "title":
        return { id, label: "Artifact", className: "w-full", render: renderTitle }
      case "workspace":
        return {
          id,
          label: "Workspace",
          render: (item) =>
            item.workspaceLabel ? (
              <span className="truncate text-[13px] text-ink-3">{item.workspaceLabel}</span>
            ) : null,
        }
      case "artifactType":
        return {
          id,
          label: "Artifact",
          render: (item) =>
            item.artifactType ? (
              <span className="inline-flex items-center rounded-[6px] bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-3">
                {getArtifactTypeLabel(item.artifactType)}
              </span>
            ) : null,
        }
      case "status":
        return {
          id,
          label: "Status",
          render: (item) => (item.status ? <WritingStatusBadge status={item.status} /> : null),
        }
      case "date":
        return {
          id,
          label: "Created",
          align: "end",
          render: (item) =>
            item.dateLabel ? (
              <span className="whitespace-nowrap text-[13px] text-ink-4">{item.dateLabel}</span>
            ) : null,
        }
      case "actions":
        return {
          id,
          label: "",
          align: "end",
          render: (item) => (
            <div className="flex items-center justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Actions for ${item.title}`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  >
                    <MoreHorizontal className="h-[14px] w-[14px]" strokeWidth={1.5} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              {actions.map((action) => {
                const { label, icon: Icon } = ACTION_CONFIG[action]
                return (
                  <DropdownMenuItem
                    key={action}
                    onClick={(event) => {
                      event.stopPropagation()
                      onActionClick?.(action, item)
                    }}
                    className="cursor-pointer gap-2 text-[13px]"
                  >
                    <Icon className="h-[12px] w-[12px]" strokeWidth={1.5} />
                    {label}
                  </DropdownMenuItem>
                )
              })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ),
        }
      default:
        return { id, render: () => null }
    }
  })
}
