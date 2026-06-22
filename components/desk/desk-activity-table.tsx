"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Bot, Check, Circle, Clipboard, Download, Eye, FileText, LayoutTemplate, MessageSquareText, MoreHorizontal, Pencil, Trash2, Wrench } from "lucide-react"
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
import { WorkspaceAssignmentDropdown } from "@/components/desk/workspace-assignment-dropdown"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"
import { ArtifactTable } from "@/components/shared/artifact-table"
import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { DocumentStateIcon } from "@/components/ui/document-state-icon"
import { TablePropertySelector } from "@/components/ui/table-property-selector"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { cn } from "@/lib/utils"

type DeskActivityTableProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
  collectionOptions: CollectionOption[]
  collectionIdsByWritingId: Record<string, string[]>
  onToggleCollection: (writingId: string, collectionId: string) => Promise<void>
  onCreateCollection: (writingId: string, name: string) => Promise<void>
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>
  onArtifactTypeChange?: (writingId: string, artifactType: ArtifactType) => Promise<void>
  workspaceOptions?: WorkspaceAssignmentOption[]
  workspaceAvailable?: boolean
  onAssignWorkspace?: (writingId: string, slug: string) => void | Promise<void>
  onUnassignWorkspace?: (writingId: string) => void | Promise<void>
  onCreateWorkspace?: (writingId: string) => void | Promise<void>
  onRenameWriting?: (writingId: string) => void
  onPreviewWriting?: (writingId: string) => void
  onCopyMarkdown?: (writingId: string) => void
  onDownloadMarkdown?: (writingId: string) => void
  onDeleteRequest?: (id: string) => void
  renderExtraActions?: (row: DeskActivityRow) => ReactNode
  showDeleteAction?: boolean
  /**
   * Selection wiring for bulk edit. When `onToggleSelection` is provided the table
   * renders a leading checkbox per row; surfaces that don't pass it (e.g. Collections)
   * get no selection column. `selectedIds` drives the selected-row styling.
   */
  selectedIds?: Set<string>
  onToggleSelection?: (id: string) => void
}

/** Stops a cell-level interaction from bubbling up to the row navigation handler. */
const stopRowNavigation = (event: { stopPropagation: () => void }) => event.stopPropagation()

function ArtifactTypeIcon({ artifactType }: { artifactType: ArtifactType }) {
  const Icon = {
    agent: Bot,
    skill: Wrench,
    prompt: MessageSquareText,
    template: LayoutTemplate,
    status: FileText,
    general: Circle,
  }[artifactType]

  return <Icon className="h-[13px] w-[13px] shrink-0 text-ink-3" strokeWidth={1.5} />
}

export function DeskActivityTable({
  groups,
  isLoading = false,
  onStatusChange,
  onArtifactTypeChange,
  workspaceOptions = [],
  workspaceAvailable = false,
  onAssignWorkspace,
  onUnassignWorkspace,
  onCreateWorkspace,
  onRenameWriting,
  onPreviewWriting,
  onCopyMarkdown,
  onDownloadMarkdown,
  onDeleteRequest,
  renderExtraActions,
  showDeleteAction = true,
  selectedIds,
  onToggleSelection,
}: DeskActivityTableProps) {
  const router = useRouter()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { settings } = useUserSettingsContext()
  const selectionEnabled = Boolean(onToggleSelection)
  const hasSelection = (selectedIds?.size ?? 0) > 0

  const renderSelection = (row: DeskActivityRow) => {
    const isRowSelected = selectedIds?.has(row.id) ?? false
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

  const enabledStatuses = useMemo(
    () => WRITING_STATUS_VALUES.filter((status) => !settings.disabledStatuses.includes(status)),
    [settings.disabledStatuses],
  )
  const tableGroups = useMemo(
    () => groups.map((group) => ({ label: group.label, items: group.rows })),
    [groups],
  )

  const columns = useMemo<ArtifactTableColumn<DeskActivityRow>[]>(
    () => [
      {
        id: "title",
        label: "Writing",
        width: "w-[55%]",
        className: "min-w-0 px-10",
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
              <DocumentStateIcon state={row.documentState} />
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
            <p className="pt-1 text-[11px] leading-[1.35] text-ink-4">Created {row.dateLabel}</p>
          </div>
        ),
      },
      {
        id: "status",
        label: "Status",
        width: "w-[12%]",
        className: "px-2",
        render: (row) => (
          <div onClick={stopRowNavigation}>
            <TablePropertySelector
              ariaLabel={`Change status for ${row.title}`}
              icon={<WritingStatusIcon status={row.stateTone} />}
              label={row.stateLabel}
              contentClassName="w-[248px]"
              onClick={stopRowNavigation}
            >
                {enabledStatuses.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    className="h-11 cursor-pointer items-center justify-between rounded-[10px] px-3 text-[14px]"
                    onClick={(event) => {
                      event.stopPropagation()
                      void onStatusChange?.(row.id, status)
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <WritingStatusIcon status={status} />
                      {getWritingStatusLabel(status)}
                    </span>
                    {row.stateTone === status ? <span className="h-2.5 w-2.5 rounded-full bg-ink" aria-hidden="true" /> : null}
                  </DropdownMenuItem>
                ))}
            </TablePropertySelector>
          </div>
        ),
      },
      {
        id: "artifact",
        label: "Artifact",
        width: "w-[14%]",
        className: "px-2",
        render: (row) => (
          <div onClick={stopRowNavigation}>
            <TablePropertySelector
              ariaLabel={`Change artifact type for ${row.title}`}
              icon={<ArtifactTypeIcon artifactType={row.artifactType ?? "general"} />}
              label={getArtifactTypeLabel(row.artifactType ?? "general")}
              contentClassName="w-[248px]"
              onClick={stopRowNavigation}
            >
              {ARTIFACT_TYPE_VALUES.map((artifactType) => (
                <DropdownMenuItem
                  key={artifactType}
                  className="h-11 cursor-pointer items-center justify-between rounded-[10px] px-3 text-[14px]"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onArtifactTypeChange?.(row.id, artifactType)
                  }}
                >
                  <span className="flex items-center gap-3">
                    <ArtifactTypeIcon artifactType={artifactType} />
                    {getArtifactTypeLabel(artifactType)}
                  </span>
                  {(row.artifactType ?? "general") === artifactType ? <span className="h-2.5 w-2.5 rounded-full bg-ink" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              ))}
            </TablePropertySelector>
          </div>
        ),
      },
      {
        id: "workspace",
        label: "Workspace",
        width: "w-[17%]",
        className: "px-2",
        render: (row) => (
          <div onClick={stopRowNavigation}>
            <WorkspaceAssignmentDropdown
              writingId={row.id}
              title={row.title}
              currentSlug={row.workspaceSlug}
              currentName={row.workspaceName}
              options={workspaceOptions}
              available={workspaceAvailable}
              variant="table"
              onAssign={(writingId, slug) => onAssignWorkspace?.(writingId, slug)}
              onUnassign={(writingId) => onUnassignWorkspace?.(writingId)}
              onCreateWorkspace={(writingId) => onCreateWorkspace?.(writingId)}
            />
          </div>
        ),
      },
      {
        id: "actions",
        label: "",
        align: "end",
        width: "w-14",
        className: "px-4",
        render: (row) => (
          <div className="flex items-center justify-end gap-2" onClick={stopRowNavigation}>
            {renderExtraActions ? <div className="shrink-0">{renderExtraActions(row)}</div> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`Actions for ${row.title}`} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3">
                  <MoreHorizontal className="h-[14px] w-[14px]" strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={stopRowNavigation}>
                {onCopyMarkdown ? <DropdownMenuItem className="cursor-pointer gap-2 text-[13px]" onClick={() => onCopyMarkdown(row.id)}><Clipboard className="h-[12px] w-[12px]" strokeWidth={1.5} />Copy markdown</DropdownMenuItem> : null}
                {onDownloadMarkdown ? <DropdownMenuItem className="cursor-pointer gap-2 text-[13px]" onClick={() => onDownloadMarkdown(row.id)}><Download className="h-[12px] w-[12px]" strokeWidth={1.5} />Download markdown</DropdownMenuItem> : null}
                {showDeleteAction ? <DropdownMenuItem className="cursor-pointer gap-2 text-[13px] text-destructive focus:text-destructive" onClick={() => setPendingDeleteId(row.id)}><Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />Delete</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [
      enabledStatuses,
      onCopyMarkdown,
      onDownloadMarkdown,
      onPreviewWriting,
      onRenameWriting,
      onStatusChange,
      onArtifactTypeChange,
      workspaceOptions,
      workspaceAvailable,
      onAssignWorkspace,
      onUnassignWorkspace,
      onCreateWorkspace,
      renderExtraActions,
      showDeleteAction,
    ],
  )

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
          isRowSelected={selectionEnabled ? (row) => selectedIds?.has(row.id) ?? false : undefined}
          renderLeading={selectionEnabled ? renderSelection : undefined}
          showHeader={false}
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
