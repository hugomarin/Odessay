"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const SETTINGS_NAV_ITEMS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/writing", label: "Writing" },
  { href: "/settings/privacy", label: "Privacy", dimmed: true },
  { href: "/settings/billing", label: "Billing", dimmed: true },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <div className="space-y-0.5">
      {SETTINGS_NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "block rounded-[8px] px-[10px] py-[8px] text-[14px] transition-colors",
              isActive
                ? "bg-muted font-medium text-ink"
                : item.dimmed
                  ? "pointer-events-none text-ink-4"
                  : "text-ink-3 hover:bg-muted hover:text-ink-2",
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
