"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"
import { LibraryControlsBar } from "@/components/library/library-controls-bar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { CollectionOption } from "@/lib/collections/collections"
import { UNCATEGORIZED_COLLECTION_ID } from "@/lib/collections/collections"
import type { DeskCreatedDateFilter, DeskGroupBy, DeskSortBy } from "@/lib/queries/desk-activity"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { getWritingStatusLabel, WRITING_STATUS_VALUES, type WritingStatus } from "@/lib/writings/status"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { cn } from "@/lib/utils"

type DeskFilterBarProps = {
  searchQuery: string; onSearchChange: (value: string) => void
  selectedCollectionIds: string[]; onToggleCollection: (id: string) => void
  selectedStatuses: WritingStatus[]; onToggleStatus: (status: WritingStatus) => void
  selectedArtifactTypes: ArtifactType[]; onToggleArtifactType: (artifactType: ArtifactType) => void
  createdDateFilter: DeskCreatedDateFilter | null; onCreatedDateFilterChange: (filter: DeskCreatedDateFilter | null) => void
  createdDateFrom: string; onCreatedDateFromChange: (value: string) => void
  createdDateTo: string; onCreatedDateToChange: (value: string) => void
  groupBy: DeskGroupBy; onGroupByChange: (value: DeskGroupBy) => void
  sortBy: DeskSortBy; onSortByChange: (value: DeskSortBy) => void
  collectionOptions: CollectionOption[]; activeFilterCount: number; hasActiveFilters: boolean; filteredCount: number; totalCount: number
}

const DATE_OPTIONS: { value: DeskCreatedDateFilter; label: string }[] = [
  { value: "today", label: "Today" }, { value: "last-7", label: "Last 7 days" }, { value: "last-30", label: "Last 30 days" }, { value: "this-year", label: "This year" }, { value: "custom", label: "Custom range" },
]
const GROUP_OPTIONS: { value: DeskGroupBy; label: string }[] = [{ value: "none", label: "None" }, { value: "status", label: "Status" }, { value: "collection", label: "Collection" }, { value: "created-date", label: "Created date" }]
const SORT_OPTIONS: { value: DeskSortBy; label: string }[] = [{ value: "created-at-desc", label: "Newest first" }, { value: "created-at-asc", label: "Oldest first" }, { value: "content-updated-at-desc", label: "Recently worked on" }]

export function DeskFilterBar(props: DeskFilterBarProps) {
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const { settings } = useUserSettingsContext()
  const collections = useMemo(() => [...props.collectionOptions, { id: UNCATEGORIZED_COLLECTION_ID, name: "Uncategorized" }], [props.collectionOptions])
  const enabledStatuses = WRITING_STATUS_VALUES.filter((status) => !settings.disabledStatuses.includes(status))
  const sortLabel = SORT_OPTIONS.find((option) => option.value === props.sortBy)?.label ?? "Newest first"

  return <div id="desk-filter-bar" data-section="desk-filter-bar" data-testid="desk-filter-bar" className="DeskFilterBar">
    <LibraryControlsBar
      searchQuery={props.searchQuery}
      onSearchChange={props.onSearchChange}
      filterActive={props.activeFilterCount > 0}
      groupActive={props.groupBy !== "none"}
      sortLabel={sortLabel}
      filterContent={<div className="flex flex-wrap gap-2"><SecondLevelControl label="Status" open={statusOpen} onOpenChange={setStatusOpen}>{enabledStatuses.map((status) => <Choice key={status} selected={props.selectedStatuses.includes(status)} onClick={() => props.onToggleStatus(status)}>{getWritingStatusLabel(status)}</Choice>)}</SecondLevelControl><SecondLevelControl label="Artifact" open={artifactOpen} onOpenChange={setArtifactOpen}>{ARTIFACT_TYPE_VALUES.map((type) => <Choice key={type} selected={props.selectedArtifactTypes.includes(type)} onClick={() => props.onToggleArtifactType(type)}>{getArtifactTypeLabel(type)}</Choice>)}</SecondLevelControl><SecondLevelControl label="Workspace" open={collectionOpen} onOpenChange={setCollectionOpen}>{collections.map((collection) => <Choice key={collection.id} selected={props.selectedCollectionIds.includes(collection.id)} onClick={() => props.onToggleCollection(collection.id)}>{collection.name}</Choice>)}</SecondLevelControl><SecondLevelControl label="Date" open={dateOpen} onOpenChange={setDateOpen}>{DATE_OPTIONS.map((option) => <Choice key={option.value} selected={props.createdDateFilter === option.value} onClick={() => props.onCreatedDateFilterChange(props.createdDateFilter === option.value ? null : option.value)}>{option.label}</Choice>)}{props.createdDateFilter === "custom" ? <div className="space-y-2 px-2 pb-2"><Input type="date" value={props.createdDateFrom} onChange={(event) => props.onCreatedDateFromChange(event.target.value)} className="h-8 text-xs"/><Input type="date" value={props.createdDateTo} onChange={(event) => props.onCreatedDateToChange(event.target.value)} className="h-8 text-xs"/></div> : null}</SecondLevelControl></div>}
      groupContent={<div className="flex flex-wrap gap-2">{GROUP_OPTIONS.map((option) => <Choice key={option.value} selected={props.groupBy === option.value} onClick={() => props.onGroupByChange(option.value)}>{option.label}</Choice>)}</div>}
      sortContent={<div className="space-y-1">{SORT_OPTIONS.map((option) => <Choice key={option.value} selected={props.sortBy === option.value} onClick={() => props.onSortByChange(option.value)}>{option.label}</Choice>)}</div>}
    />
    {props.hasActiveFilters ? <p className="mt-2 text-[11px] text-ink-4">{props.filteredCount} writing{props.filteredCount !== 1 ? "s" : ""}{props.totalCount > 0 && props.filteredCount !== props.totalCount ? ` of ${props.totalCount}` : ""} filtered</p> : null}
  </div>
}

function SecondLevelControl({ label, open, onOpenChange, children }: { label: string; open: boolean; onOpenChange: (value: boolean) => void; children: ReactNode }) {
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger asChild><button type="button" className="inline-flex h-8 items-center gap-2 rounded-[7px] bg-muted px-3 text-[12px] text-ink-2 hover:bg-muted-h">{label}<ChevronDown className="h-3 w-3" strokeWidth={1.5}/></button></PopoverTrigger><PopoverContent align="start" className="w-[220px] p-2"><div className="space-y-1">{children}</div></PopoverContent></Popover>
}
function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12px] transition-colors", selected ? "bg-muted text-ink" : "text-ink-2 hover:bg-muted/70")}><span className={cn("flex h-4 w-4 items-center justify-center rounded-[4px] border-[0.5px]", selected ? "border-ink bg-ink text-bg" : "border-border")}><Check className={cn("h-3 w-3", selected ? "opacity-100" : "opacity-0")} strokeWidth={1.5}/></span>{children}</button>
}

export function DeskFilterEmptyState({ onClear }: { onClear: () => void }) { return <div className="py-12 text-center"><p className="font-lora italic text-[15px] text-ink-3">No writings match these filters.</p><button type="button" onClick={onClear} className="mt-3 text-[13px] text-cursor hover:underline">Clear filters</button></div> }
