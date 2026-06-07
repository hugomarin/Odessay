"use client"

import { useSearchParams } from "next/navigation"
import {
  WorkspaceDetailPrototype,
  WorkspaceFilePrototype,
  WorkspaceIndexPrototype,
} from "@/components/workspace/workspace-prototype-shell"

export function DesktopWorkspaceEntry() {
  const searchParams = useSearchParams()
  const workspaceSlug = searchParams.get("slug") ?? undefined
  const fileId = searchParams.get("fileId") ?? undefined

  if (workspaceSlug && fileId) {
    return <WorkspaceFilePrototype key={`${workspaceSlug}:${fileId}`} workspaceSlug={workspaceSlug} fileId={fileId} />
  }

  if (workspaceSlug) {
    return <WorkspaceDetailPrototype key={workspaceSlug} workspaceSlug={workspaceSlug} />
  }

  return <WorkspaceIndexPrototype />
}
