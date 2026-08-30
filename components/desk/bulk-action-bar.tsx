"use client"

import { useState } from "react"
import { ChevronDown, FolderPlus, Trash2 } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SelectionBar, type SelectionBarAction } from "@/components/shared/selection-bar"
import type { CollectionOption } from "@/lib/collections/collections"
import { getWritingStatusLabel, type WritingStatus, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"

/**
 * The Desk's configuration of the shared selection bar.
 *
 * Everything visual — height, radius, background, shadow, chip treatment — lives
 * in `components/shared/selection-bar.tsx`. What is left here is the Desk's own
 * action set (status, artifact type, collections, delete) and the domain menus
 * behind it.
 */

type BulkActionBarProps = {
  selectedCount: number
  visibleCount: number
  allVisibleSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDelete: () => void
  onStatusChange: (status: WritingStatus) => Promise<void> | void
  onArtifactTypeChange: (artifactType: ArtifactType) => Promise<void> | void
  collectionOptions: CollectionOption[]
  onAddToCollection: (collectionId: string) => Promise<void> | void
  onCreateCollection: (name: string) => Promise<void> | void
  /** The Desk anchors the bar inside its sheet; other surfaces pin it to the viewport. */
  placement?: "fixed" | "absolute"
}

const MENU_ITEM_CLASS =
  "flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[13px] text-ink-2 transition-colors hover:bg-surface-menu-hover"

export function BulkActionBar({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  onSelectAll,
  onDeselectAll,
  onDelete,
  onStatusChange,
  onArtifactTypeChange,
  collectionOptions,
  onAddToCollection,
  onCreateCollection,
  placement = "fixed",
}: BulkActionBarProps) {
  const [statusOpen, setStatusOpen] = useState(false)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const { settings } = useUserSettingsContext()
  const enabledStatuses = WRITING_STATUS_VALUES.filter((s) => !settings.disabledStatuses.includes(s))

  const actions: SelectionBarAction[] = [
    {
      id: "status",
      label: "Status",
      icon: <WritingStatusIcon status="draft" className="h-[15px] w-[15px] text-bg/70" />,
      render: (chip) => (
        <Popover open={statusOpen} onOpenChange={setStatusOpen}>
          <PopoverTrigger asChild>{chip}</PopoverTrigger>
          <PopoverContent align="end" className="w-[180px] p-[5px]">
            {enabledStatuses.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  void onStatusChange(status)
                  setStatusOpen(false)
                }}
                className={MENU_ITEM_CLASS}
              >
                <WritingStatusIcon status={status} />
                <span>{getWritingStatusLabel(status)}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ),
    },
    {
      id: "artifact-type",
      label: "Artifacts",
      icon: <ArtifactTypeIcon artifactType="general" />,
      render: (chip) => (
        <Popover open={artifactOpen} onOpenChange={setArtifactOpen}>
          <PopoverTrigger asChild>{chip}</PopoverTrigger>
          <PopoverContent align="end" className="w-[180px] p-[5px]">
            {ARTIFACT_TYPE_VALUES.map((artifactType) => (
              <button
                key={artifactType}
                type="button"
                onClick={() => {
                  void onArtifactTypeChange(artifactType)
                  setArtifactOpen(false)
                }}
                className={MENU_ITEM_CLASS}
              >
                <ArtifactTypeIcon artifactType={artifactType} />
                <span>{getArtifactTypeLabel(artifactType)}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ),
    },
    {
      id: "collections",
      label: "Collections",
      icon: <FolderPlus className="h-[15px] w-[15px]" strokeWidth={1.5} />,
      render: (chip) => (
        <CollectionAssignmentMenu
          collections={collectionOptions}
          selectedIds={[]}
          align="end"
          title="Add to collection"
          description="Add selected artifacts to a collection."
          onToggleCollection={onAddToCollection}
          onCreateCollection={onCreateCollection}
          trigger={chip}
        />
      ),
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.5} />,
      destructive: true,
      onSelect: onDelete,
    },
  ]

  // The prototypes render a 14px chevron on every chip that opens a menu, and
  // none on the ones that act directly.
  for (const action of actions) {
    if (action.render) {
      action.trailingIcon = <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
    }
  }

  return (
    <SelectionBar
      id="desk-bulk-action-bar"
      data-testid="desk-bulk-action-bar"
      selectedCount={selectedCount}
      onSelectAll={onSelectAll}
      canSelectAll={!allVisibleSelected && visibleCount > 0}
      onDeselectAll={onDeselectAll}
      actions={actions}
      placement={placement}
    />
  )
}
