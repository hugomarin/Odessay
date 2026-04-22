import Link from "next/link"
import { cn } from "@/lib/utils"

type SettingsLayoutProps = Readonly<{
  children: React.ReactNode
}>

const SETTINGS_NAV_ITEMS = [
  {
    href: "/settings/account",
    label: "Account",
    description: "Identity, email, password",
    active: true,
  },
]

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div
      id="settings-shell"
      data-page="settings-shell"
      className="min-h-screen bg-[radial-gradient(circle_at_top,_hsla(22,55%,96%,0.72),_transparent_38%),linear-gradient(180deg,_hsl(var(--bg))_0%,_hsl(36_18%_97%)_100%)]"
    >
      <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-8 px-5 pb-16 pt-8 sm:px-8 lg:px-10 lg:pt-10">
        <header
          id="settings-shell-header"
          data-section="settings-shell-header"
          data-testid="settings-shell-header"
          className="space-y-3 border-b-[0.5px] border-border/80 pb-6"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-4">
            Settings
          </p>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <h1 className="font-lora text-[2.6rem] font-medium leading-[1.04] tracking-[-0.03em] text-ink sm:text-[3.1rem]">
                Account settings
              </h1>
              <p className="max-w-2xl text-[15px] leading-7 text-ink-3">
                Keep your public identity clear and your account credentials current without leaving the
                writing shell.
              </p>
            </div>

            <div className="rounded-xl border-[0.5px] border-[hsl(22_28%_84%)] bg-[hsl(22_50%_96%)] px-4 py-3 text-[13px] leading-6 text-[hsl(25_24%_32%)] shadow-float">
              Your public address updates automatically when your username changes.
            </div>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside
            id="settings-shell-sidebar"
            data-section="settings-shell-sidebar"
            data-testid="settings-shell-sidebar"
            className="lg:sticky lg:top-8 lg:self-start"
          >
            <nav className="rounded-[18px] border-[0.5px] border-border/80 bg-sb/90 p-3 shadow-float">
              <div className="mb-4 px-2 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                  Sections
                </p>
              </div>

              <div className="space-y-1.5">
                {SETTINGS_NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block rounded-xl px-4 py-3 transition-colors",
                      item.active
                        ? "bg-muted text-ink"
                        : "text-ink-3 hover:bg-muted/70 hover:text-ink",
                    )}
                  >
                    <span className="block text-[15px] font-medium">{item.label}</span>
                    <span className="mt-1 block text-[12px] leading-5 text-ink-4">{item.description}</span>
                  </Link>
                ))}
              </div>

              <div className="mt-6 rounded-xl border-[0.5px] border-border bg-bg/90 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                  Flow
                </p>
                <p className="mt-2 text-[13px] leading-6 text-ink-3">
                  Public profile details save immediately. Email and password changes use secured auth flows.
                </p>
              </div>
            </nav>
          </aside>

          <div id="settings-shell-content" data-section="settings-shell-content" data-testid="settings-shell-content">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
