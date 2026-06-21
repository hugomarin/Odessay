"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Bot, Check, ChevronDown, Circle, Clipboard, Download, Eye, FileText, FolderCog, LayoutTemplate, MessageSquareText, Monitor, MoreHorizontal, Pencil, Trash2, Wrench } from "lucide-react"
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
import { DocumentStateIcon } from "@/components/ui/document-state-icon"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { cn } from "@/lib/utils"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"

type DeskActivityTableProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
  collectionOptions: CollectionOption[]
  collectionIdsByWritingId: Record<string, string[]>
  onToggleCollection: (writingId: string, collectionId: string) => Promise<void>
  onCreateCollection: (writingId: string, name: string) => Promise<void>
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>
  onArtifactTypeChange?: (writingId: string, artifactType: ArtifactType) => Promise<void>
  onRenameWriting?: (writingId: string) => void
  onPreviewWriting?: (writingId: string) => void
  onCopyMarkdown?: (writingId: string) => void
  onDownloadMarkdown?: (writingId: string) => void
  onDeleteRequest?: (id: string) => void
  renderExtraActions?: (row: DeskActivityRow) => ReactNode
  showDeleteAction?: boolean
}

/** Stops a cell-level interaction from bubbling up to the row navigation handler. */
const stopRowNavigation = (event: { stopPropagation: () => void }) => event.stopPropagation()

const CONTROL_CLASS = "inline-flex h-9 w-fit min-w-[116px] items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
const ARTIFACT_CONTROL_CLASS = CONTROL_CLASS.replace("bg-bg", "bg-muted")

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
  onRenameWriting,
  onPreviewWriting,
  onCopyMarkdown,
  onDownloadMarkdown,
  onDeleteRequest,
  renderExtraActions,
  showDeleteAction = true,
}: DeskActivityTableProps) {
  const router = useRouter()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const { settings } = useUserSettingsContext()

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    CONTROL_CLASS,
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
        id: "artifact",
        label: "Artifact",
        width: "w-[14%]",
        className: "px-2",
        render: (row) => (
            <div onClick={stopRowNavigation}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Change artifact type for ${row.title}`}
                    className={ARTIFACT_CONTROL_CLASS}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ArtifactTypeIcon artifactType={row.artifactType ?? "general"} />
                      <span className="truncate">{getArtifactTypeLabel(row.artifactType ?? "general")}</span>
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[248px] rounded-[18px] p-2 shadow-float-md" onClick={stopRowNavigation}>
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
                </DropdownMenuContent>
              </DropdownMenu>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Manage workspace for ${row.title}`}
                  className={CONTROL_CLASS}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Monitor className="h-[12px] w-[12px] shrink-0 text-ink-4" strokeWidth={1.5} />
                    <span className="truncate">No workspace</span>
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[190px]" onClick={stopRowNavigation}>
                <DropdownMenuItem disabled className="text-[13px]">No workspace assigned</DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer gap-2 text-[13px]" onClick={() => router.push("/workspace")}>
                  <FolderCog className="h-[12px] w-[12px]" strokeWidth={1.5} />Manage workspaces
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      router,
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
