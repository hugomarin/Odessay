"use client"

import { useSearchParams } from "next/navigation"
import {
  WorkspaceDetailPrototype,
  WorkspaceFilePrototype,
  WorkspaceIndexPrototype,
} from "@/components/workspace/workspace-prototype-shell"
import { WorkspaceDesktopRequired } from "@/components/workspace/workspace-desktop-required"
import { isTauriRuntime } from "@/lib/runtime/detect"

export function DesktopWorkspaceEntry() {
  const searchParams = useSearchParams()
  const workspaceSlug = searchParams.get("slug") ?? undefined
  const fileId = searchParams.get("fileId") ?? undefined

  // Web boundary (ODE-373 req 6): filesystem-backed Workspaces require the
  // desktop runtime. On the web we render an honest explanation instead of the
  // desktop shell's folder pickers and watched-root controls.
  if (!isTauriRuntime()) {
    return <WorkspaceDesktopRequired />
  }

  if (workspaceSlug && fileId) {
    return <WorkspaceFilePrototype key={`${workspaceSlug}:${fileId}`} workspaceSlug={workspaceSlug} fileId={fileId} />
  }

  if (workspaceSlug) {
    return <WorkspaceDetailPrototype key={workspaceSlug} workspaceSlug={workspaceSlug} />
  }

  return <WorkspaceIndexPrototype />
}
