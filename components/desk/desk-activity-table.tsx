"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Clipboard, Download, Eye, Pencil, Tags, Trash2 } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CollectionOption } from "@/lib/collections/collections"
import type { DeskActivityGroup, DeskActivityRow } from "@/lib/queries/desk-activity"
import type { WritingStatus } from "@/lib/writings/status"
import { getWritingStatusLabel, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { ArtifactTable } from "@/components/shared/artifact-table"
import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { WRITING_STATUS_SURFACE_STYLES } from "@/components/ui/writing-status-badge"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { cn } from "@/lib/utils"

type DeskActivityTableProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
  collectionOptions: CollectionOption[]
  collectionIdsByWritingId: Record<string, string[]>
  onToggleCollection: (writingId: string, collectionId: string) => Promise<void>
  onCreateCollection: (writingId: string, name: string) => Promise<void>
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>
  onRenameWriting?: (writingId: string) => void
  onPreviewWriting?: (writingId: string) => void
  onCopyMarkdown?: (writingId: string) => void
  onDownloadMarkdown?: (writingId: string) => void
  onDeleteRequest?: (id: string) => void
  renderExtraActions?: (row: DeskActivityRow) => ReactNode
  showDeleteAction?: boolean
  selectedIds?: Set<string>
  onToggleSelection?: (id: string) => void
  hasSelection?: boolean
}

const buildInitials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

/** Stops a cell-level interaction from bubbling up to the row navigation handler. */
const stopRowNavigation = (event: { stopPropagation: () => void }) => event.stopPropagation()

export function DeskActivityTable({
  groups,
  isLoading = false,
  collectionOptions,
  collectionIdsByWritingId,
  onToggleCollection,
  onCreateCollection,
  onStatusChange,
  onRenameWriting,
  onPreviewWriting,
  onCopyMarkdown,
  onDownloadMarkdown,
  onDeleteRequest,
  renderExtraActions,
  showDeleteAction = true,
  selectedIds = new Set(),
  onToggleSelection,
  hasSelection = false,
}: DeskActivityTableProps) {
  const router = useRouter()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { settings } = useUserSettingsContext()

  const enabledStatuses = useMemo(
    () => WRITING_STATUS_VALUES.filter((status) => !settings.disabledStatuses.includes(status)),
    [settings.disabledStatuses],
  )
  const collectionOptionById = useMemo(
    () => new Map(collectionOptions.map((option) => [option.id, option])),
    [collectionOptions],
  )

  const tableGroups = useMemo(
    () => groups.map((group) => ({ label: group.label, items: group.rows })),
    [groups],
  )

  const columns = useMemo<ArtifactTableColumn<DeskActivityRow>[]>(
    () => [
      {
        id: "title",
        grow: true,
        render: (row) => (
          <div
            style={{
              WebkitMaskImage: "linear-gradient(90deg, #000 86%, transparent)",
              maskImage: "linear-gradient(90deg, #000 86%, transparent)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-lora text-[15px] font-medium leading-[1.3] text-ink">
                {row.title}
              </p>
              {onRenameWriting ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onRenameWriting(row.id)
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-4 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  aria-label={`Rename ${row.title}`}
                >
                  <Pencil className="h-[12px] w-[12px]" strokeWidth={1.5} />
                </button>
              ) : null}
              {onPreviewWriting ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onPreviewWriting(row.id)
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-4 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  aria-label={`Preview ${row.title}`}
                >
                  <Eye className="h-[12px] w-[12px]" strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
            {row.excerpt ? <p className="truncate pt-1 text-[12px] text-ink-3">{row.excerpt}</p> : null}
          </div>
        ),
      },
      {
        id: "status",
        width: "w-[154px]",
        render: (row) => (
          <div onClick={stopRowNavigation}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
                    WRITING_STATUS_SURFACE_STYLES[row.stateTone],
                  )}
                >
                  <WritingStatusIcon status={row.stateTone} />
                  {row.stateLabel}
                  <ChevronDown className="h-3 w-3 text-ink-4" strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]" onClick={stopRowNavigation}>
                {enabledStatuses.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    className="flex cursor-pointer items-center justify-between gap-3 text-[13px]"
                    onClick={(event) => {
                      event.stopPropagation()
                      void onStatusChange?.(row.id, status)
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <WritingStatusIcon status={status} />
                      {getWritingStatusLabel(status)}
                    </span>
                    {row.stateTone === status ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
      {
        id: "meta",
        width: "w-[196px]",
        align: "end",
        render: (row) => {
          const selectedCollectionIds = collectionIdsByWritingId[row.id] ?? []
          const selectedCollections = selectedCollectionIds
            .map((collectionId) => collectionOptionById.get(collectionId))
            .filter((collection): collection is CollectionOption => Boolean(collection))
          const isNavigable = Boolean(row.destinationHref)

          return (
            <div className="flex items-center justify-end gap-2 text-[13px] text-ink-2" onClick={stopRowNavigation}>
              {selectedCollections.length > 0 ? (
                <div className="flex min-w-0 max-w-[132px] items-center justify-end gap-1">
                  {selectedCollections.slice(0, 2).map((collection) => (
                    <span
                      key={collection.id}
                      className="inline-flex max-w-[60px] items-center rounded-[8px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-2 py-1 text-[11px] font-medium text-[hsl(28_22%_22%)]"
                    >
                      <span className="truncate">{collection.name}</span>
                    </span>
                  ))}
                  {selectedCollections.length > 2 ? (
                    <span className="shrink-0 text-[11px] text-ink-4">+{selectedCollections.length - 2}</span>
                  ) : null}
                </div>
              ) : null}
              {isNavigable ? (
                <CollectionAssignmentMenu
                  collections={collectionOptions}
                  selectedIds={selectedCollectionIds}
                  onToggleCollection={(collectionId) => onToggleCollection(row.id, collectionId)}
                  onCreateCollection={(name) => onCreateCollection(row.id, name)}
                  title="Add to collections"
                  description="Choose multiple labels, then close when you're done."
                  trigger={
                    <button
                      type="button"
                      aria-label={`Assign ${row.title} to collections`}
                      className="inline-flex h-7 shrink-0 items-center gap-[6px] rounded-[9px] border-[0.5px] border-border bg-muted/40 px-[9px] text-[11px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                    >
                      <Tags className="h-[11px] w-[11px]" strokeWidth={1.5} />
                      <span>Add</span>
                    </button>
                  }
                />
              ) : null}
              {renderExtraActions ? renderExtraActions(row) : null}
              {row.recipientPreviews.length > 0 ? (
                <div className="flex min-w-0 items-center gap-2">
                  <div className="-space-x-1 shrink-0">
                    {row.recipientPreviews.slice(0, 2).map((recipient) => {
                      const initialsSource = recipient.displayName ?? recipient.username
                      return (
                        <Avatar
                          key={recipient.username}
                          className="inline-flex h-5 w-5 border-[0.5px] border-border align-middle"
                        >
                          <AvatarFallback className="bg-ink-2 text-[9px] text-bg">
                            {buildInitials(initialsSource)}
                          </AvatarFallback>
                        </Avatar>
                      )
                    })}
                  </div>
                  <span className="min-w-0 truncate text-[13px] text-ink-2">
                    @{row.recipientPreviews[0]?.username}
                  </span>
                </div>
              ) : null}
            </div>
          )
        },
      },
      {
        id: "date",
        width: "w-[108px]",
        align: "end",
        render: (row) => (
          <span className="whitespace-nowrap text-[13px] text-ink-4">{row.dateLabel}</span>
        ),
      },
      {
        id: "actions",
        width: "w-[96px]",
        align: "end",
        render: (row) => (
          <div className="flex items-center justify-end gap-1.5" onClick={stopRowNavigation}>
            {onCopyMarkdown ? (
              <button
                type="button"
                aria-label={`Copy markdown for ${row.title}`}
                onClick={() => onCopyMarkdown(row.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
              >
                <Clipboard className="h-[12px] w-[12px]" strokeWidth={1.5} />
              </button>
            ) : null}
            {onDownloadMarkdown ? (
              <button
                type="button"
                aria-label={`Download markdown for ${row.title}`}
                onClick={() => onDownloadMarkdown(row.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
              >
                <Download className="h-[12px] w-[12px]" strokeWidth={1.5} />
              </button>
            ) : null}
            {showDeleteAction ? (
              <button
                type="button"
                aria-label={`Delete writing ${row.title}`}
                onClick={() => setPendingDeleteId(row.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4/70 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
              >
                <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [
      collectionIdsByWritingId,
      collectionOptionById,
      collectionOptions,
      enabledStatuses,
      onCopyMarkdown,
      onCreateCollection,
      onDownloadMarkdown,
      onPreviewWriting,
      onRenameWriting,
      onStatusChange,
      onToggleCollection,
      renderExtraActions,
      showDeleteAction,
    ],
  )

  const renderSelection = (row: DeskActivityRow) => {
    const isRowSelected = selectedIds.has(row.id)
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleSelection?.(row.id)
        }}
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-[4px] border transition-all duration-150",
          isRowSelected
            ? "border-ink bg-ink text-bg"
            : "border-border bg-sb text-transparent hover:border-ink-3",
          hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        aria-label={isRowSelected ? `Deselect ${row.title}` : `Select ${row.title}`}
        aria-pressed={isRowSelected}
      >
        <Check className="h-3 w-3" strokeWidth={2.2} />
      </button>
    )
  }

  if (isLoading) {
    return (
      <div
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="DeskActivityTable p-9"
      >
        <p className="text-[13px] text-ink-4">Loading local activity...</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="DeskActivityTable p-9"
      >
        <p className="font-lora text-[18px] italic text-ink-3">No recent activity.</p>
      </div>
    )
  }

  return (
    <>
      <div
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="DeskActivityTable overflow-y-auto"
      >
        <ArtifactTable
          groups={tableGroups}
          columns={columns}
          getRowId={(row) => row.id}
          getRowHref={(row) => row.destinationHref}
          onRowClick={(row) => {
            if (row.destinationHref) {
              router.push(row.destinationHref)
            }
          }}
          getRowAriaLabel={(row) =>
            row.destinationHref ? `Open writing ${row.title}` : `${row.title} is read-only on Desk`
          }
          isRowSelected={(row) => selectedIds.has(row.id)}
          renderLeading={renderSelection}
        />
      </div>

      <DeleteWritingDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null)
          }
        }}
        onConfirm={() => {
          if (pendingDeleteId) {
            onDeleteRequest?.(pendingDeleteId)
          }
          setPendingDeleteId(null)
        }}
      />
    </>
  )
}
