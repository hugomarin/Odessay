"use client"

import { useCallback, useState } from "react"
import type { WritingStatus } from "@/lib/writings/status"

export type DeskFilterState = {
  searchQuery: string
  selectedCollectionIds: string[]
  selectedStatuses: WritingStatus[]
}

export function useDeskFilters() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<WritingStatus[]>([])

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

  const clearFilters = useCallback(() => {
    setSearchQuery("")
    setSelectedCollectionIds([])
    setSelectedStatuses([])
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

  const hasActiveFilters =
    searchQuery.length > 0 || selectedCollectionIds.length > 0 || selectedStatuses.length > 0

  const activeFilterCount =
    (searchQuery.length > 0 ? 1 : 0) +
    selectedCollectionIds.length +
    selectedStatuses.length

  return {
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    setSearchQuery,
    toggleCollection,
    toggleStatus,
    clearFilters,
    clearSearch,
    clearCollections,
    clearStatuses,
    hasActiveFilters,
    activeFilterCount,
  }
}
