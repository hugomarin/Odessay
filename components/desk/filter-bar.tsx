"use client"

import { useMemo, useState } from "react"
import { Bot, Check, ChevronDown, Circle, FileText, LayoutTemplate, MessageSquareText, Search, Settings2, Wrench, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GroupByControl } from "@/components/desk/group-by-control"
import type { CollectionOption } from "@/lib/collections/collections"
import { UNCATEGORIZED_COLLECTION_ID } from "@/lib/collections/collections"
import type {
  DeskCreatedDateFilter,
  DeskGroupBy,
  DeskSortBy,
} from "@/lib/queries/desk-activity"
import {
  ARTIFACT_TYPE_VALUES,
  getArtifactTypeLabel,
  type ArtifactType,
} from "@/lib/writings/artifact-type"
import { getWritingStatusLabel, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import type { WritingStatus } from "@/lib/writings/status"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { cn } from "@/lib/utils"

type DeskFilterBarProps = {
  searchQuery: string
  onSearchChange: (value: string) => void
  selectedCollectionIds: string[]
  onToggleCollection: (id: string) => void
  selectedStatuses: WritingStatus[]
  onToggleStatus: (status: WritingStatus) => void
  selectedArtifactTypes: ArtifactType[]
  onToggleArtifactType: (artifactType: ArtifactType) => void
  createdDateFilter: DeskCreatedDateFilter | null
  onCreatedDateFilterChange: (filter: DeskCreatedDateFilter | null) => void
  createdDateFrom: string
  onCreatedDateFromChange: (value: string) => void
  createdDateTo: string
  onCreatedDateToChange: (value: string) => void
  groupBy: DeskGroupBy
  onGroupByChange: (value: DeskGroupBy) => void
  sortBy: DeskSortBy
  onSortByChange: (value: DeskSortBy) => void
  collectionOptions: CollectionOption[]
  activeFilterCount: number
  hasActiveFilters: boolean
  filteredCount: number
  totalCount: number
}

const CREATED_DATE_OPTIONS: { value: DeskCreatedDateFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last-7", label: "Last 7 days" },
  { value: "last-30", label: "Last 30 days" },
  { value: "this-year", label: "This year" },
  { value: "custom", label: "Custom range" },
]

const SORT_OPTIONS: { value: DeskSortBy; label: string }[] = [
  { value: "created-at-desc", label: "Newest first" },
  { value: "created-at-asc", label: "Oldest first" },
  { value: "content-updated-at-desc", label: "Recently worked on" },
]

const artifactTypeIconClass = "h-[13px] w-[13px]"

function ArtifactTypeIcon({ artifactType }: { artifactType: ArtifactType }) {
  switch (artifactType) {
    case "agent":
      return <Bot className={artifactTypeIconClass} strokeWidth={1.5} />
    case "skill":
      return <Wrench className={artifactTypeIconClass} strokeWidth={1.5} />
    case "prompt":
      return <MessageSquareText className={artifactTypeIconClass} strokeWidth={1.5} />
    case "template":
      return <LayoutTemplate className={artifactTypeIconClass} strokeWidth={1.5} />
    case "status":
      return <FileText className={artifactTypeIconClass} strokeWidth={1.5} />
    case "general":
    default:
      return <Circle className={artifactTypeIconClass} strokeWidth={1.5} />
  }
}

export function DeskFilterBar({
  searchQuery,
  onSearchChange,
  selectedCollectionIds,
  onToggleCollection,
  selectedStatuses,
  onToggleStatus,
  selectedArtifactTypes,
  onToggleArtifactType,
  createdDateFilter,
  onCreatedDateFilterChange,
  createdDateFrom,
  onCreatedDateFromChange,
  createdDateTo,
  onCreatedDateToChange,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  collectionOptions,
  activeFilterCount,
  hasActiveFilters,
  filteredCount,
  totalCount,
}: DeskFilterBarProps) {
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [artifactTypeOpen, setArtifactTypeOpen] = useState(false)
  const [createdDateOpen, setCreatedDateOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const { settings } = useUserSettingsContext()
  const enabledStatuses = WRITING_STATUS_VALUES.filter((s) => !settings.disabledStatuses.includes(s))

  const allCollectionOptions = useMemo(
    () => [
      ...collectionOptions,
      { id: UNCATEGORIZED_COLLECTION_ID, name: "Uncategorized" },
    ],
    [collectionOptions],
  )

  const activeCollectionsLabel = useMemo(() => {
    if (selectedCollectionIds.length === 0) return "Collections"
    if (selectedCollectionIds.length === 1) {
      const found = allCollectionOptions.find((c) => c.id === selectedCollectionIds[0])
      return `Collections: ${found?.name ?? 1}`
    }
    return `Collections: ${selectedCollectionIds.length}`
  }, [selectedCollectionIds, allCollectionOptions])

  const activeStatusesLabel = useMemo(() => {
    if (selectedStatuses.length === 0) return "Status"
    if (selectedStatuses.length === 1) {
      return `Status: ${getWritingStatusLabel(selectedStatuses[0])}`
    }
    return `Status: ${selectedStatuses.length}`
  }, [selectedStatuses])

  const activeArtifactTypesLabel = useMemo(() => {
    if (selectedArtifactTypes.length === 0) return "Artifact Type"
    if (selectedArtifactTypes.length === 1) {
      return `Artifact Type: ${getArtifactTypeLabel(selectedArtifactTypes[0])}`
    }
    return `Artifact Type: ${selectedArtifactTypes.length}`
  }, [selectedArtifactTypes])

  const activeCreatedDateLabel = useMemo(() => {
    if (!createdDateFilter) return "Created date"
    const option = CREATED_DATE_OPTIONS.find((o) => o.value === createdDateFilter)
    return `Created: ${option?.label ?? createdDateFilter}`
  }, [createdDateFilter])

  const activeSortLabel = useMemo(() => {
    const option = SORT_OPTIONS.find((o) => o.value === sortBy)
    return `Sort: ${option?.label ?? "Newest first"}`
  }, [sortBy])

  const buildCriteriaText = () => {
    const parts: string[] = []
    if (searchQuery) parts.push("name")
    if (selectedCollectionIds.length > 0) parts.push("collections")
    if (selectedStatuses.length > 0) parts.push("status")
    if (selectedArtifactTypes.length > 0) parts.push("artifact type")
    if (createdDateFilter) parts.push("created date")
    return parts.join(", ")
  }

  return (
    <div
      id="desk-filter-bar"
      data-section="desk-filter-bar"
      data-testid="desk-filter-bar"
      className="DeskFilterBar"
    >
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ink-4" strokeWidth={1.5} />
          <Input
            type="text"
            placeholder="Filter by name..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 rounded-[8px] border-transparent bg-muted/70 pl-9 pr-8 text-[13px] font-sans text-ink placeholder:text-ink-4 shadow-none"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            label={activeCollectionsLabel}
            isActive={selectedCollectionIds.length > 0}
            open={collectionsOpen}
            onOpenChange={setCollectionsOpen}
          >
            <div className="space-y-1 px-3 py-2">
              {allCollectionOptions.length > 0 ? (
                allCollectionOptions.map((collection) => {
                  const selected = selectedCollectionIds.includes(collection.id)
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => onToggleCollection(collection.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-ink bg-muted text-ink"
                          : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                            selected
                              ? "border-ink bg-ink text-bg"
                              : "border-border bg-sb text-transparent",
                          )}
                        >
                          <Check className="h-3 w-3" strokeWidth={2.2} />
                        </span>
                        <span className="text-[12px]">{collection.name}</span>
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="rounded-[8px] border-[0.5px] border-dashed border-border px-3 py-3 text-[12px] text-ink-4">
                  No collections available.
                </div>
              )}
            </div>
          </FilterChip>

          <FilterChip
            label={activeStatusesLabel}
            isActive={selectedStatuses.length > 0}
            open={statusOpen}
            onOpenChange={setStatusOpen}
          >
            <div className="space-y-1 px-3 py-2">
              {enabledStatuses.map((status) => {
                const selected = selectedStatuses.includes(status)
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => onToggleStatus(status)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                      selected
                        ? "border-ink bg-muted text-ink"
                        : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                          selected
                            ? "border-ink bg-ink text-bg"
                            : "border-border bg-sb text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={2.2} />
                      </span>
                      <span className="text-[12px]">{getWritingStatusLabel(status)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </FilterChip>

          <FilterChip
            label={activeArtifactTypesLabel}
            isActive={selectedArtifactTypes.length > 0}
            open={artifactTypeOpen}
            onOpenChange={setArtifactTypeOpen}
          >
            <div className="space-y-1 px-3 py-2">
              {ARTIFACT_TYPE_VALUES.map((artifactType) => {
                const selected = selectedArtifactTypes.includes(artifactType)
                return (
                  <button
                    key={artifactType}
                    type="button"
                    onClick={() => onToggleArtifactType(artifactType)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                      selected
                        ? "border-ink bg-muted text-ink"
                        : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                          selected
                            ? "border-ink bg-ink text-bg"
                            : "border-border bg-sb text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={2.2} />
                      </span>
                      <span className="flex items-center gap-2 text-[12px]">
                        <ArtifactTypeIcon artifactType={artifactType} />
                        {getArtifactTypeLabel(artifactType)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </FilterChip>

          <FilterChip
            label={activeCreatedDateLabel}
            isActive={createdDateFilter !== null}
            open={createdDateOpen}
            onOpenChange={setCreatedDateOpen}
          >
            <div className="space-y-1 px-3 py-2">
              {CREATED_DATE_OPTIONS.map((option) => {
                const selected = createdDateFilter === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      onCreatedDateFilterChange(selected ? null : option.value)
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                      selected
                        ? "border-ink bg-muted text-ink"
                        : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                          selected
                            ? "border-ink bg-ink text-bg"
                            : "border-border bg-sb text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={2.2} />
                      </span>
                      <span className="text-[12px]">{option.label}</span>
                    </span>
                  </button>
                )
              })}
              {createdDateFilter === "custom" && (
                <div className="space-y-2 pt-2">
                  <label className="block text-[11px] text-ink-4">From</label>
                  <Input
                    type="date"
                    value={createdDateFrom}
                    onChange={(e) => onCreatedDateFromChange(e.target.value)}
                    className="h-8 rounded-[6px] border-[0.5px] border-border bg-sb text-[12px] font-sans"
                  />
                  <label className="block text-[11px] text-ink-4">To</label>
                  <Input
                    type="date"
                    value={createdDateTo}
                    onChange={(e) => onCreatedDateToChange(e.target.value)}
                    className="h-8 rounded-[6px] border-[0.5px] border-border bg-sb text-[12px] font-sans"
                  />
                </div>
              )}
            </div>
          </FilterChip>

          <GroupByControl value={groupBy} onChange={onGroupByChange} />

          <FilterChip
            label={activeSortLabel}
            isActive={sortBy !== "created-at-desc"}
            open={sortOpen}
            onOpenChange={setSortOpen}
            icon={<Settings2 className="h-[13px] w-[13px]" strokeWidth={1.5} />}
          >
            <div className="space-y-1 px-3 py-2">
              {SORT_OPTIONS.map((option) => {
                const selected = sortBy === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSortByChange(option.value)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                      selected
                        ? "border-ink bg-muted text-ink"
                        : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                          selected
                            ? "border-ink bg-ink text-bg"
                            : "border-border bg-sb text-transparent",
                        )}
                      >
                        <Check className="h-3 w-3" strokeWidth={2.2} />
                      </span>
                      <span className="text-[12px]">{option.label}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </FilterChip>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-4">
          <span>
            {filteredCount} writing{filteredCount !== 1 ? "s" : ""}
            {totalCount > 0 && filteredCount !== totalCount ? ` of ${totalCount}` : ""}
            {activeFilterCount > 0 ? ` · Filtered by ${buildCriteriaText()}` : ""}
          </span>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  isActive,
  open,
  onOpenChange,
  icon,
  children,
}: {
  label: string
  isActive: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[13px] font-medium transition-colors",
            isActive
              ? "bg-ink text-bg hover:opacity-90"
              : "bg-muted/70 text-ink-2 hover:bg-muted",
          )}
        >
          {icon}
          {label}
          {!icon && <ChevronDown className="h-3 w-3 text-ink-4" strokeWidth={1.5} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-0">
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function DeskFilterEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="font-lora text-[15px] italic text-ink-3">
        No writings match your filters
      </p>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-8 items-center rounded-[8px] bg-ink px-3 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
      >
        Clear filters
      </button>
    </div>
  )
}
