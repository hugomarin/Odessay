"use client"

import { Sidebar } from "@/components/navigation/sidebar"
import { UserSettingsProvider } from "@/components/settings/user-settings-provider"

/**
 * The real rail over a neutral sheet, so the side-by-side against the
 * prototypes compares the shipped component and the capture can hold it
 * expanded without the editor collapsing it back.
 */
export function RailHarnessClient() {
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
        {/* Layer 1, so the rail's transparency reads against a real sheet. */}
        <div className="h-screen p-4">
          <div className="h-full rounded-[10px] bg-sb shadow-float" />
        </div>
      </Sidebar>
    </UserSettingsProvider>
  )
}
