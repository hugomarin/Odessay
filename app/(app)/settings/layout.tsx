import { SignOutButton } from "@/components/auth/sign-out-button"
import { ViewTitlebarSpacer } from "@/components/navigation/view-titlebar-spacer"
import { SettingsNav } from "@/components/settings/settings-nav"

type SettingsLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div
      id="settings-shell"
      data-page="settings-shell"
      className="flex min-h-screen flex-col bg-bg"
    >
      {/* The chrome row stays free here too — the settings nav starts below it. */}
      <ViewTitlebarSpacer />
      <div className="flex min-h-0 flex-1">
      <aside
        id="settings-shell-nav"
        data-section="settings-shell-nav"
        data-testid="settings-shell-nav"
        className="hidden w-[180px] flex-shrink-0 flex-col border-r-[0.5px] border-border lg:flex"
        style={{ padding: "24px 12px" }}
      >
        <nav className="flex flex-1 flex-col">
          <p
            className="font-lora text-[17px] font-medium text-ink"
            style={{ padding: "0 8px", marginBottom: "20px" }}
          >
            Settings
          </p>

          <SettingsNav />
        </nav>

        <div
          className="mt-auto border-t-[0.5px] border-border"
          style={{ paddingTop: "12px" }}
        >
          <SignOutButton
            variant="ghost"
            className="h-auto w-full justify-start px-[10px] py-[8px] text-[13px] text-ink-4 hover:bg-muted hover:text-ink-2"
          />
        </div>
      </aside>

      <main
        id="settings-shell-content"
        data-section="settings-shell-content"
        data-testid="settings-shell-content"
        className="flex-1 overflow-y-auto"
        style={{ padding: "32px 40px" }}
      >
        <div className="mx-auto max-w-[640px]">
          {children}
        </div>
      </main>
      </div>
    </div>
  )
}
