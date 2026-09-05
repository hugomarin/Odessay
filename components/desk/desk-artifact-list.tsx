"use client"

import { useMemo, useState } from "react"

import { DeskArtifactRow } from "@/components/desk/desk-artifact-row"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { DocumentStateTooltipProvider } from "@/components/ui/document-state-badge"
import { useVocabulary } from "@/hooks/useVocabulary"
import { listVisibleVocabulary } from "@/lib/vocabulary/resolve"
import { SELECTION_BAR_SHEET_ATTR } from "@/components/shared/selection-bar"
import type { DeskActivityGroup, DeskActivityRow } from "@/lib/queries/desk-activity"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import type { WritingStatus } from "@/lib/writings/status"

/**
 * The Desk's scrolling list: group labels and artifact rows inside the sheet.
 *
 * The sheet is marked with `SELECTION_BAR_SHEET_ATTR` so the shared selection
 * bar pads it while it is up and the last row stays clickable.
 *
 * Loading renders skeleton rows at the row's own height — never a spinner —
 * and a failed row mutation surfaces on the row itself rather than in a toast
 * that scrolls away.
 */

export type DeskArtifactListProps = {
  groups: DeskActivityGroup[]
  isLoading?: boolean
  /** Rendered inside the sheet when there is nothing to show. */
  emptyState?: React.ReactNode
  selectedIds?: Set<string>
  onToggleSelection?: (id: string) => void
  onActivate?: (row: DeskActivityRow) => void
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
  /** Absolute timestamps by row id, shown in the date's `title`. */
  absoluteDates?: Record<string, string>
}

const SKELETON_ROWS = 6

export function DeskArtifactList({
  groups,
  isLoading = false,
  emptyState,
  selectedIds,
  onToggleSelection,
  onActivate,
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
  absoluteDates,
}: DeskArtifactListProps) {
  const catalog = useVocabulary()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const enabledStatuses = useMemo(
    () => listVisibleVocabulary(catalog, "status").map((item) => item.key),
    [catalog],
  )
  const enabledArtifactTypes = useMemo(
    () => listVisibleVocabulary(catalog, "type").map((item) => item.key),
    [catalog],
  )

  const clearRowError = (id: string) =>
    setRowErrors((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })

  /**
   * A row mutation that fails must say so on the row. The optimistic update is
   * owned by the caller's reload; what this adds is the visible, dismissible
   * failure next to the artifact it belongs to.
   */
  const runRowMutation = async (
    id: string,
    message: string,
    mutate: (() => Promise<void>) | undefined,
  ) => {
    if (!mutate) return
    clearRowError(id)
    try {
      await mutate()
    } catch {
      setRowErrors((current) => ({ ...current, [id]: message }))
    }
  }

  const hasRows = groups.some((group) => group.rows.length > 0)
  // Skeletons stand in for rows that are not there yet — never over rows that
  // are. A refetch behind a populated list must not blank it out, and a list
  // that already has its data must not sit behind skeletons if the surrounding
  // load never reports finishing.
  const showSkeletons = isLoading && !hasRows

  return (
    <DocumentStateTooltipProvider>
      <div
        {...{ [SELECTION_BAR_SHEET_ATTR]: "" }}
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="od-scroll min-h-0 flex-1 overflow-y-auto"
      >
        {showSkeletons ? (
          <div data-testid="desk-artifact-skeletons" aria-busy="true" aria-label="Loading artifacts">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <DeskArtifactRowSkeleton key={index} />
            ))}
          </div>
        ) : hasRows ? (
          <>
            {groups.map((group, groupIndex) =>
              group.rows.length === 0 ? null : (
                <div key={group.label || `group-${groupIndex}`} data-testid="desk-artifact-group">
                  {group.label ? (
                    <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-4">
                        {group.label}
                      </span>
                      <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-surface-menu-hover px-1.5 text-[11px] font-medium text-ink-3">
                        {group.rows.length}
                      </span>
                      <span aria-hidden className="h-px flex-1 bg-line-softer" />
                    </div>
                  ) : null}

                  {group.rows.map((row) => (
                    <DeskArtifactRow
                      key={row.id}
                      row={row}
                      selected={selectedIds?.has(row.id) ?? false}
                      onToggleSelection={onToggleSelection}
                      onActivate={onActivate}
                      enabledStatuses={enabledStatuses}
                      enabledArtifactTypes={enabledArtifactTypes}
                      onStatusChange={(writingId, status) =>
                        runRowMutation(writingId, "Couldn't change the status. Try again.", () =>
                          Promise.resolve(onStatusChange?.(writingId, status)).then(() => undefined),
                        )
                      }
                      onArtifactTypeChange={(writingId, artifactType) =>
                        runRowMutation(writingId, "Couldn't change the artifact type. Try again.", () =>
                          Promise.resolve(onArtifactTypeChange?.(writingId, artifactType)).then(
                            () => undefined,
                          ),
                        )
                      }
                      workspaceOptions={workspaceOptions}
                      workspaceAvailable={workspaceAvailable}
                      onAssignWorkspace={onAssignWorkspace}
                      onUnassignWorkspace={onUnassignWorkspace}
                      onCreateWorkspace={onCreateWorkspace}
                      onRenameWriting={onRenameWriting}
                      onPreviewWriting={onPreviewWriting}
                      onCopyMarkdown={onCopyMarkdown}
                      onDownloadMarkdown={onDownloadMarkdown}
                      onDeleteRequest={onDeleteRequest ? setPendingDeleteId : undefined}
                      absoluteDate={absoluteDates?.[row.id]}
                      error={rowErrors[row.id] ?? null}
                    />
                  ))}
                </div>
              ),
            )}
            {/* The prototype closes the scroll with a 40px block. */}
            <div aria-hidden className="h-10" />
          </>
        ) : (
          emptyState
        )}
      </div>

      <DeleteWritingDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
        onConfirm={() => {
          if (pendingDeleteId) onDeleteRequest?.(pendingDeleteId)
          setPendingDeleteId(null)
        }}
      />
    </DocumentStateTooltipProvider>
  )
}

/** A skeleton at the row's own rhythm, so nothing shifts when the data lands. */
function DeskArtifactRowSkeleton() {
  return (
    <div
      data-testid="desk-artifact-row-skeleton"
      className="flex items-start gap-4 border-b-[0.5px] border-line-softer px-[26px] py-[14px]"
    >
      <div className="mt-px h-5 w-5 flex-shrink-0 animate-pulse rounded-[5px] bg-muted" />
      <div className="min-w-0 flex-1">
        <div className="mb-[3px] h-[19px] w-[240px] animate-pulse rounded-[4px] bg-muted" />
        <div className="h-[19px] w-[420px] max-w-full animate-pulse rounded-[4px] bg-muted/70" />
      </div>
      <div className="hidden flex-shrink-0 items-center gap-2.5 pt-0.5 min-[1240px]:flex">
        <div className="h-[38px] w-[160px] animate-pulse rounded-[8px] bg-muted" />
        <div className="h-[38px] w-[160px] animate-pulse rounded-[8px] bg-muted" />
        <div className="h-[38px] w-[160px] animate-pulse rounded-[8px] bg-muted" />
        <div className="h-8 w-8 animate-pulse rounded-[8px] bg-muted" />
      </div>
    </div>
  )
}
