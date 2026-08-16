"use client"

import { usePathname } from "next/navigation"

import { SETTINGS_SECTIONS, isSettingsSectionActive } from "@/components/settings/settings-nav"

/**
 * The `h1` + one-line subtitle above the sheet.
 *
 * Title and subtitle are read from `docs/design/views/settings.md`, which
 * carries the English copy; the prototype's own strings are Spanish placeholders
 * and only its geometry applies — 32/1.1 at weight 500 with `-0.02em`, over a
 * 14/1.6 subtitle capped at 56ch. Divergence recorded in the ODE-432 PR.
 */
export function SettingsSectionHeader({ href }: { href?: string }) {
  const pathname = usePathname()
  // `/evidence` renders the shell off-route, so it names the section directly.
  const active = href ?? pathname
  const section = SETTINGS_SECTIONS.find((entry) => isSettingsSectionActive(active, entry.href))

  if (!section) return null

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-3" data-testid="settings-section-header">
      <h1 className="mb-1.5 text-[32px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
        {section.title}
      </h1>
      <p className="max-w-[56ch] text-pretty text-[14px] leading-[1.6] text-ink-3">
        {section.subtitle}
      </p>
    </div>
  )
}
