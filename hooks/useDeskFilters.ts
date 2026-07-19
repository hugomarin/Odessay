"use client"

import { useCallback, useState } from "react"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import type {
  DeskCreatedDateFilter,
  DeskGroupBy,
  DeskSortBy,
} from "@/lib/queries/desk-activity"
import type { WritingStatus } from "@/lib/writings/status"

export type DeskFilterState = {
  searchQuery: string
  selectedCollectionIds: string[]
  selectedStatuses: WritingStatus[]
  selectedArtifactTypes: ArtifactType[]
  selectedWorkspaceSlugs: string[]
  createdDateFilter: DeskCreatedDateFilter | null
  createdDateFrom: string
  createdDateTo: string
  groupBy: DeskGroupBy
  sortBy: DeskSortBy
}

export function useDeskFilters() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<WritingStatus[]>([])
  const [selectedArtifactTypes, setSelectedArtifactTypes] = useState<ArtifactType[]>([])
  const [selectedWorkspaceSlugs, setSelectedWorkspaceSlugs] = useState<string[]>([])
  const [createdDateFilter, setCreatedDateFilter] = useState<DeskCreatedDateFilter | null>(null)
  const [createdDateFrom, setCreatedDateFrom] = useState("")
  const [createdDateTo, setCreatedDateTo] = useState("")
  const [groupBy, setGroupBy] = useState<DeskGroupBy>("none")
  const [sortBy, setSortBy] = useState<DeskSortBy>("created-at-desc")

  const toggleCollection = useCallback((id: string) => {
    setSelectedCollectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }, [])

  const toggleStatus = useCallback((status: WritingStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    )
  }, [])

  const toggleArtifactType = useCallback((artifactType: ArtifactType) => {
    setSelectedArtifactTypes((prev) =>
      prev.includes(artifactType)
        ? prev.filter((t) => t !== artifactType)
        : [...prev, artifactType],
    )
  }, [])

  const toggleWorkspace = useCallback((slug: string) => {
    setSelectedWorkspaceSlugs((prev) =>
      prev.includes(slug) ? prev.filter((workspaceSlug) => workspaceSlug !== slug) : [...prev, slug],
    )
  }, [])

  const clearFilters = useCallback(() => {
    setSearchQuery("")
    setSelectedCollectionIds([])
    setSelectedStatuses([])
    setSelectedArtifactTypes([])
    setSelectedWorkspaceSlugs([])
    setCreatedDateFilter(null)
    setCreatedDateFrom("")
    setCreatedDateTo("")
    setGroupBy("none")
    setSortBy("created-at-desc")
  }, [])

  const clearSearch = useCallback(() => {
    setSearchQuery("")
  }, [])

  const clearCollections = useCallback(() => {
    setSelectedCollectionIds([])
  }, [])

  const clearStatuses = useCallback(() => {
    setSelectedStatuses([])
  }, [])

  const clearArtifactTypes = useCallback(() => {
    setSelectedArtifactTypes([])
  }, [])

  const clearCreatedDate = useCallback(() => {
    setCreatedDateFilter(null)
    setCreatedDateFrom("")
    setCreatedDateTo("")
  }, [])

  const hasActiveFilters =
    searchQuery.length > 0 ||
    selectedCollectionIds.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedArtifactTypes.length > 0 ||
    selectedWorkspaceSlugs.length > 0 ||
    createdDateFilter !== null

  const activeFilterCount =
    (searchQuery.length > 0 ? 1 : 0) +
    selectedCollectionIds.length +
    selectedStatuses.length +
    selectedArtifactTypes.length +
    selectedWorkspaceSlugs.length +
    (createdDateFilter !== null ? 1 : 0)

  return {
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    selectedArtifactTypes,
    selectedWorkspaceSlugs,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    groupBy,
    sortBy,
    setSearchQuery,
    toggleCollection,
    toggleStatus,
    toggleArtifactType,
    toggleWorkspace,
    setCreatedDateFilter,
    setCreatedDateFrom,
    setCreatedDateTo,
    setGroupBy,
    setSortBy,
    clearFilters,
    clearSearch,
    clearCollections,
    clearStatuses,
    clearArtifactTypes,
    clearCreatedDate,
    hasActiveFilters,
    activeFilterCount,
  }
}
