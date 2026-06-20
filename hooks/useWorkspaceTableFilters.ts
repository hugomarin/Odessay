"use client"

import { useState } from "react"

export type WorkspaceFileDateFilter = "all" | "last-7"
export type WorkspaceFileGroupBy = "none" | "folder"
export type WorkspaceFileSortBy = "newest" | "oldest" | "name"

/** UI state for the reusable Workspace file-table controls. */
export function useWorkspaceTableFilters() {
  const [dateFilter, setDateFilter] = useState<WorkspaceFileDateFilter>("all")
  const [groupBy, setGroupBy] = useState<WorkspaceFileGroupBy>("none")
  const [sortBy, setSortBy] = useState<WorkspaceFileSortBy>("newest")

  return { dateFilter, setDateFilter, groupBy, setGroupBy, sortBy, setSortBy }
}
