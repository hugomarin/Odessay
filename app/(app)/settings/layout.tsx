import { ViewTitlebarSpacer } from "@/components/navigation/view-titlebar-spacer"
import { SettingsShell } from "@/components/settings/settings-shell"

type SettingsLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div
      id="settings-shell"
      data-page="settings-shell"
      className="flex h-screen min-h-0 flex-col bg-bg"
    >
      {/* The chrome row stays free here too — the settings nav starts below it. */}
      <ViewTitlebarSpacer />

      <SettingsShell>{children}</SettingsShell>
    </div>
  )
}
