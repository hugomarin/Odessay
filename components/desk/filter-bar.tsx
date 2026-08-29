"use client"

import { useMemo, useState, type ReactNode } from "react"
import { ArrowUpDown, Check, ChevronDown, Filter, Folder, Group, Search } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { APP_SHELL_CONTENT_GUTTER_CLASS } from "@/components/navigation/view-header"
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import type { CollectionOption } from "@/lib/collections/collections"
import { UNCATEGORIZED_COLLECTION_ID } from "@/lib/collections/collections"
import {
  NO_WORKSPACE_FILTER_VALUE,
  type DeskCreatedDateFilter,
  type DeskGroupBy,
  type DeskSortBy,
} from "@/lib/queries/desk-activity"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { getWritingStatusLabel, WRITING_STATUS_VALUES, type WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

/**
 * Desk toolbar — one row of 38px controls, and its height never changes.
 *
 * The prototype puts every facet behind a single **Filter** dropdown with a
 * section per facet and a footer, next to **Group by** and **Sort**. Applied
 * filters show as a count on the Filter trigger — never as chips under the bar,
 * which is what would make the row grow.
 */

type DeskFilterBarProps = {
  leading?: ReactNode
  searchQuery: string; onSearchChange: (value: string) => void
  selectedCollectionIds: string[]; onToggleCollection: (id: string) => void
  selectedStatuses: WritingStatus[]; onToggleStatus: (status: WritingStatus) => void
  selectedArtifactTypes: ArtifactType[]; onToggleArtifactType: (artifactType: ArtifactType) => void
  selectedWorkspaceSlugs: string[]; onToggleWorkspace: (slug: string) => void
  createdDateFilter: DeskCreatedDateFilter | null; onCreatedDateFilterChange: (filter: DeskCreatedDateFilter | null) => void
  createdDateFrom: string; onCreatedDateFromChange: (value: string) => void
  createdDateTo: string; onCreatedDateToChange: (value: string) => void
  groupBy: DeskGroupBy; onGroupByChange: (value: DeskGroupBy) => void
  sortBy: DeskSortBy; onSortByChange: (value: DeskSortBy) => void
  collectionOptions: CollectionOption[]
  workspaceOptions: WorkspaceAssignmentOption[]
  activeFilterCount: number
  hasActiveFilters: boolean
  filteredCount: number
  totalCount: number
  onClearFilters?: () => void
}

const DATE_OPTIONS: { value: DeskCreatedDateFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last-7", label: "Last 7 days" },
  { value: "last-30", label: "Last 30 days" },
  { value: "this-year", label: "This year" },
  { value: "custom", label: "Custom range" },
]

// Order and labels from the prototype's `groupOptions`.
const GROUP_OPTIONS: { value: DeskGroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "collection", label: "Collection" },
  { value: "status", label: "Status" },
  { value: "artifact", label: "Artifact type" },
  { value: "created-date", label: "Created date" },
]

const SORT_OPTIONS: { value: DeskSortBy; label: string }[] = [
  { value: "created-at-desc", label: "Newest first" },
  { value: "created-at-asc", label: "Oldest first" },
  { value: "content-updated-at-desc", label: "Recently worked on" },
]

/** 38px, radius 9, hairline border; tinted while its menu is open or its facet is applied. */
function toolButtonClass(active: boolean): string {
  return cn(
    "inline-flex h-[38px] flex-shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[9px]",
    "border-[0.5px] px-[13px] text-[14px] font-medium text-ink-2 transition-colors [&>svg]:text-ink-3",
    active
      ? "border-ink-5 bg-surface-menu-hover [&>svg]:text-ink"
      : "border-border bg-sb hover:bg-surface-menu-hover",
  )
}

export function DeskFilterBar(props: DeskFilterBarProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const { settings } = useUserSettingsContext()

  const collections = useMemo(
    () => [...props.collectionOptions, { id: UNCATEGORIZED_COLLECTION_ID, name: "Uncategorized" }],
    [props.collectionOptions],
  )
  const enabledStatuses = WRITING_STATUS_VALUES.filter(
    (status) => !settings.disabledStatuses.includes(status),
  )

  const sortLabel = SORT_OPTIONS.find((option) => option.value === props.sortBy)?.label ?? "Newest first"
  const groupLabel =
    props.groupBy === "none"
      ? "Group by"
      : `Group: ${GROUP_OPTIONS.find((option) => option.value === props.groupBy)?.label ?? ""}`
  const filterLabel = props.activeFilterCount > 0 ? `Filter · ${props.activeFilterCount}` : "Filter"

  return (
    <div
      id="desk-filter-bar"
      data-section="desk-filter-bar"
      data-testid="desk-filter-bar"
      className={cn(
        "DeskFilterBar flex flex-shrink-0 flex-wrap items-center gap-[14px] pb-3",
        APP_SHELL_CONTENT_GUTTER_CLASS,
      )}
    >
      {props.leading}

      <span className="flex h-[38px] min-w-[160px] flex-1 items-center gap-[9px] rounded-[9px] border-[0.5px] border-border bg-sb px-3">
        <Search className="h-[14px] w-[14px] flex-shrink-0 text-ink-4" strokeWidth={1.5} />
        <input
          value={props.searchQuery}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="Filter by name…"
          aria-label="Filter by name"
          data-testid="desk-filter-search"
          className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-5"
        />
      </span>

      <div className="flex flex-shrink-0 items-center gap-2">
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="desk-filter-trigger"
              className={toolButtonClass(filterOpen || props.activeFilterCount > 0)}
            >
              <Filter className="h-[14px] w-[14px]" strokeWidth={1.5} />
              {filterLabel}
              <ChevronDown className="h-[13px] w-[13px]" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[246px] p-0">
            <div className="od-scroll max-h-[384px] overflow-y-auto p-[5px]">
              <FacetSection label="Status">
                {enabledStatuses.map((status) => (
                  <FacetOption
                    key={status}
                    selected={props.selectedStatuses.includes(status)}
                    onClick={() => props.onToggleStatus(status)}
                    mark={<WritingStatusIcon status={status} className="h-[14px] w-[14px]" />}
                  >
                    {getWritingStatusLabel(status)}
                  </FacetOption>
                ))}
              </FacetSection>

              <FacetSection label="Artifact type">
                {ARTIFACT_TYPE_VALUES.map((type) => (
                  <FacetOption
                    key={type}
                    selected={props.selectedArtifactTypes.includes(type)}
                    onClick={() => props.onToggleArtifactType(type)}
                    mark={<ArtifactTypeIcon artifactType={type} />}
                  >
                    {getArtifactTypeLabel(type)}
                  </FacetOption>
                ))}
              </FacetSection>

              {props.workspaceOptions.length > 0 ? (
                <FacetSection label="Workspace">
                  {props.workspaceOptions.map((workspace) => (
                    <FacetOption
                      key={workspace.slug}
                      selected={props.selectedWorkspaceSlugs.includes(workspace.slug)}
                      onClick={() => props.onToggleWorkspace(workspace.slug)}
                      mark={<Folder className="h-[14px] w-[14px] text-ink-3" strokeWidth={1.5} />}
                    >
                      {workspace.name}
                    </FacetOption>
                  ))}
                  <FacetOption
                    selected={props.selectedWorkspaceSlugs.includes(NO_WORKSPACE_FILTER_VALUE)}
                    onClick={() => props.onToggleWorkspace(NO_WORKSPACE_FILTER_VALUE)}
                    mark={<Folder className="h-[14px] w-[14px] text-ink-3" strokeWidth={1.5} />}
                  >
                    No workspace
                  </FacetOption>
                </FacetSection>
              ) : null}

              <FacetSection label="Collection">
                {collections.map((collection) => (
                  <FacetOption
                    key={collection.id}
                    selected={props.selectedCollectionIds.includes(collection.id)}
                    onClick={() => props.onToggleCollection(collection.id)}
                  >
                    {collection.name}
                  </FacetOption>
                ))}
              </FacetSection>

              <FacetSection label="Created">
                {DATE_OPTIONS.map((option) => (
                  <FacetOption
                    key={option.value}
                    selected={props.createdDateFilter === option.value}
                    onClick={() =>
                      props.onCreatedDateFilterChange(
                        props.createdDateFilter === option.value ? null : option.value,
                      )
                    }
                  >
                    {option.label}
                  </FacetOption>
                ))}
                {props.createdDateFilter === "custom" ? (
                  <div className="space-y-2 px-2 pb-2 pt-1">
                    <Input
                      type="date"
                      aria-label="From"
                      value={props.createdDateFrom}
                      onChange={(event) => props.onCreatedDateFromChange(event.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="date"
                      aria-label="To"
                      value={props.createdDateTo}
                      onChange={(event) => props.onCreatedDateToChange(event.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                ) : null}
              </FacetSection>
            </div>

            <div className="flex items-center justify-between gap-2.5 border-t-[0.5px] border-line-soft px-3 py-2">
              <span className="text-[12px] text-ink-4">
                {props.filteredCount} {props.filteredCount === 1 ? "artifact" : "artifacts"}
              </span>
              <button
                type="button"
                onClick={props.onClearFilters}
                data-testid="desk-filter-clear-all"
                className="text-[12px] font-medium text-ink-4 transition-colors hover:text-ink"
              >
                Clear all
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={groupOpen} onOpenChange={setGroupOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="desk-group-trigger"
              className={toolButtonClass(groupOpen || props.groupBy !== "none")}
            >
              <Group className="h-[14px] w-[14px]" strokeWidth={1.5} />
              {groupLabel}
              <ChevronDown className="h-[13px] w-[13px]" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[200px] p-[5px]">
            {GROUP_OPTIONS.map((option) => (
              <MenuChoice
                key={option.value}
                selected={props.groupBy === option.value}
                onClick={() => {
                  props.onGroupByChange(option.value)
                  setGroupOpen(false)
                }}
              >
                {option.label}
              </MenuChoice>
            ))}
          </PopoverContent>
        </Popover>

        <Popover open={sortOpen} onOpenChange={setSortOpen}>
          <PopoverTrigger asChild>
            <button type="button" data-testid="desk-sort-trigger" className={toolButtonClass(sortOpen)}>
              <ArrowUpDown className="h-[14px] w-[14px]" strokeWidth={1.5} />
              Sort: {sortLabel}
              <ChevronDown className="h-[13px] w-[13px]" strokeWidth={1.5} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[220px] p-[5px]">
            {SORT_OPTIONS.map((option) => (
              <MenuChoice
                key={option.value}
                selected={props.sortBy === option.value}
                onClick={() => {
                  props.onSortByChange(option.value)
                  setSortOpen(false)
                }}
              >
                {option.label}
              </MenuChoice>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

function FacetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="px-[9px] pb-[5px] pt-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">
        {label}
      </p>
      {children}
    </div>
  )
}

function FacetOption({
  selected,
  onClick,
  mark,
  children,
}: {
  selected: boolean
  onClick: () => void
  mark?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex h-[34px] w-full items-center gap-2.5 rounded-[7px] px-[9px] text-left text-[13px] transition-colors hover:bg-surface-menu-hover",
        selected ? "font-medium text-ink" : "font-normal text-ink-2",
      )}
    >
      <span
        className={cn(
          "inline-flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors",
          selected ? "border-ink bg-ink" : "border-ink-6 bg-sb",
        )}
      >
        <Check className={cn("h-[11px] w-[11px] text-bg", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} />
      </span>
      {mark ? <span className="flex flex-shrink-0 items-center">{mark}</span> : null}
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}

function MenuChoice({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center rounded-[6px] px-2.5 text-left text-[13px] transition-colors hover:bg-surface-menu-hover",
        selected ? "font-medium text-ink" : "font-normal text-ink-2",
      )}
    >
      {children}
    </button>
  )
}

/**
 * "No results" — an inline block inside the sheet, never a full page.
 *
 * Type from the prototype's own empty block (Lora 500/20 over a 14px hint); the
 * "Clear all" button is the behaviour `docs/design/views/desk.md` requires and
 * the prototype does not draw. Both are recorded in the ODE-430 PR.
 */
export function DeskFilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div data-testid="desk-filter-empty" className="px-4 py-20 text-center">
      <p className="mb-1.5 font-lora text-[20px] font-medium leading-[1.3] text-ink">No results</p>
      <p className="text-[14px] leading-[1.5] text-ink-4">
        Adjust the filters or create a new artifact.
      </p>
      <button
        type="button"
        onClick={onClear}
        data-testid="desk-filter-empty-clear"
        className="mt-4 inline-flex h-[38px] items-center rounded-[9px] border-[0.5px] border-border bg-sb px-[15px] text-[13px] text-ink-2 transition-colors hover:bg-surface-menu-hover"
      >
        Clear all
      </button>
    </div>
  )
}
