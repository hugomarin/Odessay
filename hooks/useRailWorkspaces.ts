"use client"

import { useEffect, useState } from "react"

import { getWorkspaceAssignmentService } from "@/lib/services/workspace-service"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"

/**
 * The workspace folders the rail lists under its Workspace item.
 *
 * The prototypes draw this block where the repo had a "Recent" list — the rail
 * is an inventory of places, not of history. It reads from the same
 * `WorkspaceAssignmentService` the Desk and the Workspace view already use, so
 * no second source of workspaces enters the app; on web the service reports
 * `isAvailable: false` and the block simply has nothing to render.
 *
 * Read-only: the rail navigates to a workspace, it never assigns or renames.
 */
export function useRailWorkspaces(): WorkspaceAssignmentOption[] {
  const [workspaces, setWorkspaces] = useState<WorkspaceAssignmentOption[]>([])

  useEffect(() => {
    let cancelled = false
    const service = getWorkspaceAssignmentService()

    if (!service.isAvailable) {
      return
    }

    void service
      .listWorkspaces()
      .then((options) => {
        if (!cancelled) {
          setWorkspaces(options)
        }
      })
      .catch(() => {
        // A rail that cannot list workspaces shows no folders. It never blocks
        // navigation, and it never invents a folder that is not there.
        if (!cancelled) {
          setWorkspaces([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return workspaces
}
