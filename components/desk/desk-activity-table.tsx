"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Clipboard,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react";
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CollectionOption } from "@/lib/collections/collections";
import type {
  DeskActivityGroup,
  DeskActivityRow,
} from "@/lib/queries/desk-activity";
import type { WritingStatus } from "@/lib/writings/status";
import { getWritingStatusLabel } from "@/lib/writings/status";
import { useVocabulary } from "@/hooks/useVocabulary";
import { getVocabularyColor, listVisibleVocabulary } from "@/lib/vocabulary/resolve";
import { VocabularyChip } from "@/components/ui/vocabulary-chip";
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog";
import { WorkspaceAssignmentDropdown } from "@/components/desk/workspace-assignment-dropdown";
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu";
import { CollectionChips } from "@/components/desk/collection-chips";
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment";
import { ArtifactTable } from "@/components/shared/artifact-table";
import { ArtifactRowSelection } from "@/components/shared/artifact-row-selection";
import {
  ArtifactWritingAction,
  ArtifactWritingCell,
} from "@/components/shared/artifact-writing-cell";
import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types";
import { DocumentStateTooltipProvider } from "@/components/ui/document-state-badge";
import { WritingStatusIcon } from "@/components/ui/writing-status-icon";
import { TablePropertySelector } from "@/components/ui/table-property-selector";
import {
  getArtifactTypeLabel,
  type ArtifactType,
} from "@/lib/writings/artifact-type";

type DeskActivityTableProps = {
  groups: DeskActivityGroup[];
  isLoading?: boolean;
  collectionOptions: CollectionOption[];
  collectionIdsByWritingId: Record<string, string[]>;
  onToggleCollection: (
    writingId: string,
    collectionId: string,
  ) => Promise<void>;
  onCreateCollection: (writingId: string, name: string) => Promise<void>;
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>;
  onArtifactTypeChange?: (
    writingId: string,
    artifactType: ArtifactType,
  ) => Promise<void>;
  workspaceOptions?: WorkspaceAssignmentOption[];
  workspaceAvailable?: boolean;
  onAssignWorkspace?: (writingId: string, slug: string) => void | Promise<void>;
  onUnassignWorkspace?: (writingId: string) => void | Promise<void>;
  onCreateWorkspace?: (writingId: string) => void | Promise<void>;
  onRenameWriting?: (writingId: string) => void;
  onPreviewWriting?: (writingId: string) => void;
  onCopyMarkdown?: (writingId: string) => void;
  onDownloadMarkdown?: (writingId: string) => void;
  onDeleteRequest?: (id: string) => void;
  renderExtraActions?: (row: DeskActivityRow) => ReactNode;
  /** Extra items rendered at the top of the row's "…" actions menu (e.g. "Remove from collection"). */
  renderExtraMenuItems?: (row: DeskActivityRow) => ReactNode;
  showDeleteAction?: boolean;
  /**
   * Selection wiring for bulk edit. When `onToggleSelection` is provided the table
   * renders a leading checkbox per row; surfaces that don't pass it (e.g. Collections)
   * get no selection column. `selectedIds` drives the selected-row styling.
   */
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  /** Hide the workspace column on surfaces that don't manage workspace assignment (e.g. Collections). */
  showWorkspaceColumn?: boolean;
};

/** Stops a cell-level interaction from bubbling up to the row navigation handler. */
const stopRowNavigation = (event: { stopPropagation: () => void }) =>
  event.stopPropagation();

export { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon";

export function DeskActivityTable({
  groups,
  isLoading = false,
  collectionOptions,
  collectionIdsByWritingId,
  onToggleCollection,
  onCreateCollection,
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
  renderExtraMenuItems,
  showDeleteAction = true,
  selectedIds,
  onToggleSelection,
  showWorkspaceColumn = true,
}: DeskActivityTableProps) {
  const router = useRouter();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const catalog = useVocabulary();
  const selectionEnabled = Boolean(onToggleSelection);

  const renderSelection = (row: DeskActivityRow) => {
    const isRowSelected = selectedIds?.has(row.id) ?? false;
    return (
      <ArtifactRowSelection
        label={isRowSelected ? `Deselect ${row.title}` : `Select ${row.title}`}
        selected={isRowSelected}
        onToggle={() => onToggleSelection?.(row.id)}
      />
    );
  };

  const enabledStatuses = useMemo(
    () => listVisibleVocabulary(catalog, "status").map((item) => item.key),
    [catalog],
  );
  const enabledArtifactTypes = useMemo(
    () => listVisibleVocabulary(catalog, "type").map((item) => item.key),
    [catalog],
  );
  const tableGroups = useMemo(
    () => groups.map((group) => ({ label: group.label, items: group.rows })),
    [groups],
  );

  const columns = useMemo<ArtifactTableColumn<DeskActivityRow>[]>(
    () => [
      {
        id: "title",
        label: "Artifact",
        className: "min-w-0 pl-2 pr-5",
        render: (row) => (
          <ArtifactWritingCell
            title={row.title}
            documentState={row.documentState}
            description={row.excerpt}
            localPath={row.localPath}
            dateLabel={row.dateLabel}
            actions={
              <>
                {onRenameWriting ? (
                  <ArtifactWritingAction
                    label={`Rename ${row.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRenameWriting(row.id);
                    }}
                  >
                    <Pencil className="h-[14px] w-[14px]" strokeWidth={1.5} />
                  </ArtifactWritingAction>
                ) : null}
                {onPreviewWriting ? (
                  <ArtifactWritingAction
                    label={`Preview ${row.title}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onPreviewWriting(row.id);
                    }}
                  >
                    <Eye className="h-[14px] w-[14px]" strokeWidth={1.5} />
                  </ArtifactWritingAction>
                ) : null}
                {collectionOptions.length > 0 ? (
                  <div onClick={stopRowNavigation}>
                    <CollectionAssignmentMenu
                      collections={collectionOptions}
                      selectedIds={collectionIdsByWritingId[row.id] ?? []}
                      align="start"
                      title="Collections"
                      description="Choose labels for this artifact."
                      onToggleCollection={(collectionId) =>
                        void onToggleCollection(row.id, collectionId)
                      }
                      onCreateCollection={(name) =>
                        void onCreateCollection(row.id, name)
                      }
                      trigger={
                        <ArtifactWritingAction
                          label={`Assign collections for ${row.title}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Tag
                            className="h-[14px] w-[14px]"
                            strokeWidth={1.5}
                          />
                        </ArtifactWritingAction>
                      }
                    />
                  </div>
                ) : null}
              </>
            }
            collections={
              <CollectionChips
                collectionIds={collectionIdsByWritingId[row.id] ?? []}
                collectionOptions={collectionOptions}
              />
            }
          />
        ),
      },
      {
        id: "status",
        label: "Status",
        width: "w-[144px]",
        className: "px-2",
        render: (row) => (
          <div onClick={stopRowNavigation}>
            <TablePropertySelector
              variant="preview"
              ariaLabel={`Change status for ${row.title}`}
              icon={
                <VocabularyChip color={getVocabularyColor(catalog, "status", row.stateTone)} size={20}>
                  <WritingStatusIcon status={row.stateTone} className="h-[12px] w-[12px]" />
                </VocabularyChip>
              }
              label={row.stateLabel}
              className="min-w-[128px]"
              contentClassName="w-[248px]"
              onClick={stopRowNavigation}
            >
              {enabledStatuses.map((status) => (
                <DropdownMenuItem
                  key={status}
                  className="h-11 cursor-pointer items-center justify-between rounded-[10px] px-3 text-[14px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onStatusChange?.(row.id, status);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <VocabularyChip color={getVocabularyColor(catalog, "status", status)} size={20}>
                      <WritingStatusIcon status={status} className="h-[12px] w-[12px]" />
                    </VocabularyChip>
                    {getWritingStatusLabel(status)}
                  </span>
                  {row.stateTone === status ? (
                    <span
                      className="h-2.5 w-2.5 rounded-full bg-ink"
                      aria-hidden="true"
                    />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </TablePropertySelector>
          </div>
        ),
      },
      {
        id: "artifact",
        label: "Artifact",
        width: "w-[156px]",
        className: "px-2",
        render: (row) => (
          <div onClick={stopRowNavigation}>
            <TablePropertySelector
              ariaLabel={`Change artifact type for ${row.title}`}
              icon={
                <VocabularyChip
                  color={getVocabularyColor(catalog, "type", row.artifactType ?? "general")}
                  size={20}
                >
                  <ArtifactTypeIcon
                    artifactType={row.artifactType ?? "general"}
                    className="h-[12px] w-[12px]"
                  />
                </VocabularyChip>
              }
              label={getArtifactTypeLabel(row.artifactType ?? "general")}
              className="min-w-[140px]"
              contentClassName="w-[248px]"
              onClick={stopRowNavigation}
            >
              {enabledArtifactTypes.map((artifactType) => (
                <DropdownMenuItem
                  key={artifactType}
                  className="h-11 cursor-pointer items-center justify-between rounded-[10px] px-3 text-[14px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onArtifactTypeChange?.(row.id, artifactType);
                  }}
                >
                  <span className="flex items-center gap-3">
                    <VocabularyChip color={getVocabularyColor(catalog, "type", artifactType)} size={20}>
                      <ArtifactTypeIcon artifactType={artifactType} className="h-[12px] w-[12px]" />
                    </VocabularyChip>
                    {getArtifactTypeLabel(artifactType)}
                  </span>
                  {(row.artifactType ?? "general") === artifactType ? (
                    <span
                      className="h-2.5 w-2.5 rounded-full bg-ink"
                      aria-hidden="true"
                    />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </TablePropertySelector>
          </div>
        ),
      },
      {
        id: "workspace",
        label: "Workspace",
        width: "w-[180px]",
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
              onAssign={(writingId, slug) =>
                onAssignWorkspace?.(writingId, slug)
              }
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
        width: "w-[56px]",
        className: "pl-2 pr-4",
        render: (row) => {
          const extraMenuItems = renderExtraMenuItems?.(row);
          const hasMenu = Boolean(
            extraMenuItems ||
            onCopyMarkdown ||
            onDownloadMarkdown ||
            showDeleteAction,
          );
          return (
            <div
              className="flex items-center justify-end gap-2"
              onClick={stopRowNavigation}
            >
              {renderExtraActions ? (
                <div className="shrink-0">{renderExtraActions(row)}</div>
              ) : null}
              {hasMenu ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${row.title}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-transparent text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                    >
                      <MoreHorizontal
                        className="h-[14px] w-[14px]"
                        strokeWidth={1.5}
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={stopRowNavigation}>
                    {extraMenuItems}
                    {onCopyMarkdown ? (
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 text-[13px]"
                        onClick={() => onCopyMarkdown(row.id)}
                      >
                        <Clipboard
                          className="h-[12px] w-[12px]"
                          strokeWidth={1.5}
                        />
                        Copy markdown
                      </DropdownMenuItem>
                    ) : null}
                    {onDownloadMarkdown ? (
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 text-[13px]"
                        onClick={() => onDownloadMarkdown(row.id)}
                      >
                        <Download
                          className="h-[12px] w-[12px]"
                          strokeWidth={1.5}
                        />
                        Download markdown
                      </DropdownMenuItem>
                    ) : null}
                    {showDeleteAction ? (
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 text-[13px] text-destructive focus:text-destructive"
                        onClick={() => setPendingDeleteId(row.id)}
                      >
                        <Trash2
                          className="h-[12px] w-[12px]"
                          strokeWidth={1.5}
                        />
                        Delete
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        },
      },
    ],
    [
      enabledStatuses,
      enabledArtifactTypes,
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
      renderExtraMenuItems,
      showDeleteAction,
      collectionOptions,
      collectionIdsByWritingId,
      onToggleCollection,
      onCreateCollection,
      catalog,
    ],
  );

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
    );
  }

  if (groups.length === 0) {
    return (
      <div
        id="desk-activity-table"
        data-section="desk-activity-table"
        data-testid="desk-activity-table"
        className="DeskActivityTable p-9"
      >
        <p className="font-lora text-[18px] italic text-ink-3">
          No recent activity.
        </p>
      </div>
    );
  }

  return (
    <DocumentStateTooltipProvider>
      <>
        <div
          id="desk-activity-table"
          data-section="desk-activity-table"
          data-testid="desk-activity-table"
          className="DeskActivityTable overflow-y-auto"
        >
          <ArtifactTable
            groups={tableGroups}
            columns={
              showWorkspaceColumn
                ? columns
                : columns.filter((column) => column.id !== "workspace")
            }
            getRowId={(row) => row.id}
            getRowHref={(row) => row.destinationHref}
            onRowClick={(row) => {
              if (row.destinationHref) {
                router.push(row.destinationHref);
              }
            }}
            getRowAriaLabel={(row) =>
              row.destinationHref
                ? `Open artifact ${row.title}`
                : `${row.title} is read-only on Desk`
            }
            isRowSelected={
              selectionEnabled
                ? (row) => selectedIds?.has(row.id) ?? false
                : undefined
            }
            renderLeading={selectionEnabled ? renderSelection : undefined}
            showHeader={false}
            tableClassName="min-w-[920px]"
            rowCellClassName="py-4"
            leadingColumnClassName="w-9"
            leadingCellClassName="w-9 pl-3 pr-0 pt-[17px] sm:pl-3"
          />
        </div>

        <DeleteWritingDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDeleteId(null);
            }
          }}
          onConfirm={() => {
            if (pendingDeleteId) {
              onDeleteRequest?.(pendingDeleteId);
            }
            setPendingDeleteId(null);
          }}
        />
      </>
    </DocumentStateTooltipProvider>
  );
}
