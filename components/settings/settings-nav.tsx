"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Archive, CircleDashed, LogOut, Shapes, UserRound } from "lucide-react"

import { SignOutButton } from "@/components/auth/sign-out-button"
import { cn } from "@/lib/utils"

/**
 * The Settings nav — 244px, `--size-settings-nav`.
 *
 * Rows are 38px with a 34px icon column, and requirement 1 pins their active and
 * hover treatment to the app rail's rather than to the prototype's literal
 * hexes. Divergence recorded in the ODE-432 PR: the render fills the active row
 * with `#E7E5E1`; the rail (ODE-447) uses `--muted-h` (`#E9E7E3`) and the
 * requirement says to match the rail.
 */

export const SETTINGS_SECTIONS = [
  {
    href: "/settings/account",
    label: "Account",
    icon: UserRound,
    title: "Account",
    subtitle: "Your profile and how you sign in. Artifacts live in your folders, not here.",
  },
  {
    href: "/settings/types",
    label: "Artifact types",
    icon: Shapes,
    title: "Artifact types",
    subtitle:
      "Each type has its own icon and color, and appears in the editor selector and the Desk filters.",
  },
  {
    href: "/settings/status",
    label: "Status",
    icon: CircleDashed,
    title: "Artifact statuses",
    subtitle: "Choose which statuses appear in menus and filters, and how they look.",
  },
  {
    href: "/settings/archived",
    label: "Archived artifacts",
    icon: Archive,
    title: "Archived artifacts",
    subtitle: "Download, restore or permanently delete what you archived.",
  },
] as const

const ROW_CLASS =
  "flex h-[38px] w-full items-center gap-0.5 rounded-[9px] pr-1.5 text-[14px] leading-none transition-colors duration-[180ms]"
const ICON_WRAP_CLASS = "flex w-[34px] min-w-[34px] items-center justify-center"

export function isSettingsSectionActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SettingsNav({ href }: { href?: string } = {}) {
  const pathname = usePathname()
  // `/evidence` renders the nav off-route, so it names the active section.
  const active = href ?? pathname

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const isActive = isSettingsSectionActive(active, section.href)

          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={isActive ? "page" : undefined}
              data-testid={`settings-nav-${section.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn(
                ROW_CLASS,
                isActive
                  ? "bg-muted-hover font-medium text-ink"
                  : "font-normal text-ink-2 hover:bg-muted hover:text-ink",
              )}
            >
              <span className={cn(ICON_WRAP_CLASS, isActive ? "text-ink-2" : "text-ink-4")}>
                <section.icon className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
            </Link>
          )
        })}
      </div>

      <div className="mt-auto border-t-[0.5px] border-border pt-3">
        <SignOutButton
          variant="ghost"
          icon={
            <span className={cn(ICON_WRAP_CLASS, "text-ink-4")}>
              <LogOut className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </span>
          }
          className={cn(
            ROW_CLASS,
            "justify-start gap-0.5 p-0 pr-1.5 font-normal text-ink-2 hover:bg-muted hover:text-ink",
          )}
        />
      </div>
    </>
  )
}
