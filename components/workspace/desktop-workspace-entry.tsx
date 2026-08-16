"use client"

import { useSearchParams } from "next/navigation"
import { WorkspaceDetail } from "@/components/workspace/workspace-detail"
import { WorkspaceIndex } from "@/components/workspace/workspace-index"
import { WorkspaceDesktopRequired } from "@/components/workspace/workspace-desktop-required"
import { isTauriRuntime } from "@/lib/runtime/detect"

export function DesktopWorkspaceEntry() {
  const searchParams = useSearchParams()
  const workspaceSlug = searchParams.get("slug") ?? undefined

  // Web boundary (ODE-373 req 6): filesystem-backed Workspaces require the
  // desktop runtime. On the web we render an honest explanation instead of the
  // desktop shell's folder pickers and watched-root controls.
  if (!isTauriRuntime()) {
    return <WorkspaceDesktopRequired />
  }

  if (workspaceSlug) {
    return <WorkspaceDetail key={workspaceSlug} workspaceSlug={workspaceSlug} />
  }

  return <WorkspaceIndex />
}
