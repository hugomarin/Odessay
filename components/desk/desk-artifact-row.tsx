"use client"

import { type ReactNode } from "react"
import {
  Check,
  ChevronDown,
  Clipboard,
  Download,
  Ellipsis,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DocumentStateIcon } from "@/components/ui/document-state-icon"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon"
import { WorkspaceAssignmentDropdown } from "@/components/desk/workspace-assignment-dropdown"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"
import { getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { getWritingStatusLabel, type WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

/**
 * One artifact row, as the Desk prototype draws it.
 *
 * The prototype's row is not a table row and is not a fixed 60px: it is a
 * two-line flex row padded `14px 26px`, with the date living inside the title
 * block's second line rather than in a column of its own, and status, type and
 * workspace as three 160px triggers on the right. Both divergences from
 * `docs/design/views/desk.md` are recorded in the ODE-430 PR — per
 * `docs/design/migration-plan.md` §4 the prototype is the authority.
 *
 * The control cluster is hidden below 1240px, which is where the prototype drops
 * it; the row keeps its title block and reveals inline actions on row intent.
 */

export const DESK_ROW_CONTROL_WIDTH = "w-[160px]"

/** Stops a control inside the row from also activating the row's navigation. */
const stopRowNavigation = (event: { stopPropagation: () => void }) => event.stopPropagation()

export type DeskArtifactRowProps = {
  row: DeskActivityRow
  selected: boolean
  onToggleSelection?: (id: string) => void
  onActivate?: (row: DeskActivityRow) => void
  enabledStatuses: WritingStatus[]
  enabledArtifactTypes: ArtifactType[]
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void> | void
  onArtifactTypeChange?: (writingId: string, artifactType: ArtifactType) => Promise<void> | void
  workspaceOptions: WorkspaceAssignmentOption[]
  workspaceAvailable: boolean
  onAssignWorkspace?: (writingId: string, slug: string) => void | Promise<void>
  onUnassignWorkspace?: (writingId: string) => void | Promise<void>
  onCreateWorkspace?: (writingId: string) => void | Promise<void>
  onRenameWriting?: (writingId: string) => void
  onPreviewWriting?: (writingId: string) => void
  onCopyMarkdown?: (writingId: string) => void
  onDownloadMarkdown?: (writingId: string) => void
  onDeleteRequest?: (writingId: string) => void
  /** Absolute timestamp shown in `title` next to the relative date. */
  absoluteDate?: string
  /** Message from a failed row mutation, rendered in the row itself. */
  error?: string | null
}

export function DeskArtifactRow({
  row,
  selected,
  onToggleSelection,
  onActivate,
  enabledStatuses,
  enabledArtifactTypes,
  onStatusChange,
  onArtifactTypeChange,
  workspaceOptions,
  workspaceAvailable,
  onAssignWorkspace,
  onUnassignWorkspace,
  onCreateWorkspace,
  onRenameWriting,
  onPreviewWriting,
  onCopyMarkdown,
  onDownloadMarkdown,
  onDeleteRequest,
  absoluteDate,
  error,
}: DeskArtifactRowProps) {
  const artifactType = row.artifactType ?? "general"
  const navigable = Boolean(onActivate && row.destinationHref)

  return (
    <div
      data-testid="desk-artifact-row"
      data-selected={selected || undefined}
      role={navigable ? "link" : undefined}
      tabIndex={navigable ? 0 : undefined}
      aria-label={navigable ? `Open artifact ${row.title}` : undefined}
      onClick={navigable ? () => onActivate?.(row) : undefined}
      onKeyDown={
        navigable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onActivate?.(row)
              }
            }
          : undefined
      }
      className={cn(
        "group/desk-row flex items-start gap-4 border-b-[0.5px] border-line-softer px-[26px] py-[14px] transition-colors",
        "hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink-3",
        navigable && "cursor-pointer",
        selected && "bg-surface-selected",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? `Deselect ${row.title}` : `Select ${row.title}`}
        data-testid="desk-artifact-row-checkbox"
        onClick={(event) => {
          stopRowNavigation(event)
          onToggleSelection?.(row.id)
        }}
        className={cn(
          "mt-px inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
          selected ? "border-ink bg-ink" : "border-ink-6 bg-sb",
        )}
      >
        <Check className={cn("h-3 w-3 text-bg", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-[3px] flex items-center gap-2">
          <h3 className="truncate text-[15px] font-medium leading-[1.3] text-ink">{row.title}</h3>
          <DocumentStateIcon state={row.documentState} className="h-[22px] w-[22px]" />
          {onRenameWriting ? (
            <RowIconButton
              label={`Rename ${row.title}`}
              onClick={(event) => {
                stopRowNavigation(event)
                onRenameWriting(row.id)
              }}
            >
              <Pencil className="h-[14px] w-[14px]" strokeWidth={1.5} />
            </RowIconButton>
          ) : null}
          {onPreviewWriting ? (
            <RowIconButton
              label={`Preview ${row.title}`}
              onClick={(event) => {
                stopRowNavigation(event)
                onPreviewWriting(row.id)
              }}
            >
              <Eye className="h-[14px] w-[14px]" strokeWidth={1.5} />
            </RowIconButton>
          ) : null}
        </div>

        <div className="flex min-w-0 max-w-[88ch] items-baseline gap-2">
          <span
            title={absoluteDate}
            className="flex-shrink-0 whitespace-nowrap text-[12px] leading-[1.5] text-ink-5"
          >
            {row.dateLabel}
          </span>
          <span aria-hidden className="h-[3px] w-[3px] flex-shrink-0 -translate-y-[3px] rounded-full bg-ink-6" />
          <p className="min-w-0 flex-1 truncate text-[13px] leading-[1.5] text-ink-3">{row.excerpt}</p>
        </div>

        {error ? (
          <p
            role="status"
            data-testid="desk-artifact-row-error"
            className="mt-1.5 text-[12px] leading-[1.5] text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div
        data-testid="desk-artifact-row-controls"
        onClick={stopRowNavigation}
        className="hidden flex-shrink-0 items-center gap-2.5 pt-0.5 min-[1240px]:flex"
      >
        <div className={DESK_ROW_CONTROL_WIDTH}>
          <RowTrigger
            label={row.stateLabel}
            ariaLabel={`Change status for ${row.title}`}
            leading={<WritingStatusIcon status={row.stateTone} className="h-[15px] w-[15px]" />}
            items={enabledStatuses.map((status) => ({
              key: status,
              label: getWritingStatusLabel(status),
              leading: <WritingStatusIcon status={status} className="h-[15px] w-[15px]" />,
              selected: row.stateTone === status,
              onSelect: () => void onStatusChange?.(row.id, status),
            }))}
          />
        </div>

        <div className={DESK_ROW_CONTROL_WIDTH}>
          <RowTrigger
            label={getArtifactTypeLabel(artifactType)}
            ariaLabel={`Change artifact type for ${row.title}`}
            leading={<ArtifactTypeIcon artifactType={artifactType} />}
            items={enabledArtifactTypes.map((type) => ({
              key: type,
              label: getArtifactTypeLabel(type),
              leading: <ArtifactTypeIcon artifactType={type} />,
              selected: artifactType === type,
              onSelect: () => void onArtifactTypeChange?.(row.id, type),
            }))}
          />
        </div>

        <div className={DESK_ROW_CONTROL_WIDTH}>
          <WorkspaceAssignmentDropdown
            writingId={row.id}
            title={row.title}
            currentSlug={row.workspaceSlug}
            currentName={row.workspaceName}
            options={workspaceOptions}
            available={workspaceAvailable}
            variant="desk"
            onAssign={(writingId, slug) => onAssignWorkspace?.(writingId, slug)}
            onUnassign={(writingId) => onUnassignWorkspace?.(writingId)}
            onCreateWorkspace={(writingId) => onCreateWorkspace?.(writingId)}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${row.title}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-surface-menu-hover hover:text-ink data-[state=open]:bg-surface-menu-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
            >
              <Ellipsis className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[196px]" onClick={stopRowNavigation}>
            {onCopyMarkdown ? (
              <DropdownMenuItem className="cursor-pointer gap-2.5" onClick={() => onCopyMarkdown(row.id)}>
                <Clipboard className="h-[14px] w-[14px] text-ink-3" strokeWidth={1.5} />
                Copy markdown
              </DropdownMenuItem>
            ) : null}
            {onDownloadMarkdown ? (
              <DropdownMenuItem className="cursor-pointer gap-2.5" onClick={() => onDownloadMarkdown(row.id)}>
                <Download className="h-[14px] w-[14px] text-ink-3" strokeWidth={1.5} />
                Download markdown
              </DropdownMenuItem>
            ) : null}
            {onDeleteRequest ? (
              <DropdownMenuItem
                className="cursor-pointer gap-2.5 text-destructive focus:text-destructive"
                onClick={() => onDeleteRequest(row.id)}
              >
                <Trash2 className="h-[14px] w-[14px]" strokeWidth={1.5} />
                Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/**
 * A row action. The row keeps these controls quiet until the user hovers or
 * focuses the writing, while the focus-within state keeps keyboard access clear.
 */
function RowIconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: (event: React.MouseEvent) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="pointer-events-none inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[6px] text-ink-5 opacity-0 transition-[opacity,background-color,color] hover:bg-surface-menu-hover hover:text-ink focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3 group-hover/desk-row:pointer-events-auto group-hover/desk-row:opacity-100 group-focus-within/desk-row:pointer-events-auto group-focus-within/desk-row:opacity-100"
    >
      {children}
    </button>
  )
}

/** The row's 38px property trigger — status and artifact type share it. */
function RowTrigger({
  label,
  ariaLabel,
  leading,
  items,
}: {
  label: string
  ariaLabel: string
  leading: ReactNode
  items: Array<{ key: string; label: string; leading?: ReactNode; selected: boolean; onSelect: () => void }>
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex h-[38px] w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-sb px-[11px] text-[13px] text-ink-2 transition-colors hover:border-ink-6 hover:bg-surface-row-hover data-[state=open]:border-ink-5 data-[state=open]:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
        >
          <span className="flex flex-shrink-0 items-center text-ink-3">{leading}</span>
          <span className="flex-1 truncate text-left">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[248px] rounded-[18px] p-2 shadow-float-md">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            className={cn(
              "flex h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] transition-colors hover:bg-surface-menu-hover",
              item.selected ? "font-medium text-ink" : "font-normal text-ink-2",
            )}
          >
            {item.leading ? <span className="flex flex-shrink-0 items-center text-ink-3">{item.leading}</span> : null}
            <span className="flex-1 truncate">{item.label}</span>
            {item.selected ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink" aria-hidden /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
