import { Suspense } from "react"
import { DesktopWorkspaceEntry } from "@/components/workspace/desktop-workspace-entry"

function DesktopWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <DesktopWorkspaceEntry />
    </Suspense>
  )
}

export default function WorkspacePage() {
  return <DesktopWorkspacePage />
}
