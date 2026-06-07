import { Suspense } from "react"
import { DesktopWorkspaceEntry } from "@/components/workspace/desktop-workspace-entry"
import { WorkspaceIndexPrototype } from "@/components/workspace/workspace-prototype-shell"

const isTauriBuild = process.env.TAURI_BUILD === "true"

function DesktopWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <DesktopWorkspaceEntry />
    </Suspense>
  )
}

export default function WorkspacePage() {
  return isTauriBuild ? <DesktopWorkspacePage /> : <WorkspaceIndexPrototype />
}
