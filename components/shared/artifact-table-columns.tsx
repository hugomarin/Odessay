"use client"

import { Clipboard, ExternalLink, Trash2 } from "lucide-react"

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
        return { id, grow: true, render: renderTitle }
      case "workspace":
        return {
          id,
          width: "w-[160px]",
          render: (item) =>
            item.workspaceLabel ? (
              <span className="truncate text-[13px] text-ink-3">{item.workspaceLabel}</span>
            ) : null,
        }
      case "artifactType":
        return {
          id,
          width: "w-[120px]",
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
          width: "w-[132px]",
          render: (item) => (item.status ? <WritingStatusBadge status={item.status} /> : null),
        }
      case "date":
        return {
          id,
          width: "w-[120px]",
          align: "end",
          render: (item) =>
            item.dateLabel ? (
              <span className="whitespace-nowrap text-[13px] text-ink-4">{item.dateLabel}</span>
            ) : null,
        }
      case "actions":
        return {
          id,
          width: "w-[92px]",
          align: "end",
          render: (item) => (
            <div className="flex items-center justify-end gap-1.5">
              {actions.map((action) => {
                const { label, icon: Icon } = ACTION_CONFIG[action]
                return (
                  <button
                    key={action}
                    type="button"
                    aria-label={`${label} ${item.title}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onActionClick?.(action, item)
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-ink-2 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  >
                    <Icon className="h-[12px] w-[12px]" strokeWidth={1.5} />
                  </button>
                )
              })}
            </div>
          ),
        }
      default:
        return { id, render: () => null }
    }
  })
}
