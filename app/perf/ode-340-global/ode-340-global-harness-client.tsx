"use client"

import { EditorShell } from "@/components/editor/editor-shell"
import { Sidebar } from "@/components/navigation/sidebar"
import { UserSettingsProvider } from "@/components/settings/user-settings-provider"

/**
 * ODE-340 visual harness. It mounts the real editor inside the real global
 * sidebar so local captures can prove both left-side panels coexist.
 */
export function Ode340GlobalHarnessClient() {
  return (
    <UserSettingsProvider>
      <Sidebar
        initialSidebarMode="expanded"
        user={{
          displayName: "Evidence Writer",
          email: "evidence@odessay.local",
          username: "evidence",
        }}
      >
        <div className="h-screen overflow-hidden [&_.EditorLayout]:h-screen [&_.EditorLayout]:min-h-0 [&_#editor]:h-screen [&_#editor]:min-h-0">
          <EditorShell forceNewWriting />
        </div>
      </Sidebar>
    </UserSettingsProvider>
  )
}
