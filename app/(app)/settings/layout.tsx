import Link from "next/link"
import { SignOutButton } from "@/components/auth/sign-out-button"
import { cn } from "@/lib/utils"

type SettingsLayoutProps = Readonly<{
  children: React.ReactNode
}>

const SETTINGS_NAV_ITEMS = [
  { href: "/settings/account", label: "Account", active: true },
  { href: "/settings/writing", label: "Writing", active: true },
  { href: "/settings/privacy", label: "Privacy", active: false, dimmed: true },
  { href: "/settings/billing", label: "Billing", active: false, dimmed: true },
]

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div
      id="settings-shell"
      data-page="settings-shell"
      className="flex min-h-screen bg-bg"
    >
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

          <div className="space-y-0.5">
            {SETTINGS_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block text-[14px] transition-colors",
                  "py-[8px] px-[10px] rounded-[8px]",
                  item.active
                    ? "bg-muted font-medium text-ink"
                    : item.dimmed
                      ? "pointer-events-none text-ink-4"
                      : "text-ink-3 hover:bg-muted hover:text-ink-2",
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
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
  )
}
