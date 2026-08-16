import { SelectionBarSheet } from "@/components/settings/selection-bar-sheet"
import { SettingsNav } from "@/components/settings/settings-nav"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"

/**
 * Settings shell — `rail 52 | settings nav 244 | sheet`.
 *
 * The 52px rail is the app rail from `app/(app)/layout.tsx`; this owns the two
 * columns to its right. Geometry read from the render of
 * `Artifact Studio Settings.dc.html`: a 10px gutter between nav and sheet, the
 * nav padded 6px either side, and the sheet a white card at radius 10 over the
 * shell background, holding its own scroller so the section header stays put
 * while the section scrolls under it.
 *
 * It lives here rather than inline in the route layout so the `/evidence` pages
 * can screenshot the real shell for the fidelity gate instead of a lookalike.
 */
export function SettingsShell({
  children,
  section,
}: {
  children: React.ReactNode
  /** Names the section when the shell is rendered off-route, as `/evidence` does. */
  section?: string
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-2.5 pb-2.5 pr-2.5">
      <nav
        id="settings-shell-nav"
        data-section="settings-shell-nav"
        data-testid="settings-shell-nav"
        className="hidden w-[var(--size-settings-nav)] flex-shrink-0 flex-col px-1.5 lg:flex"
      >
        <p className="mb-3.5 px-2.5 text-[20px] font-medium leading-none tracking-[-0.01em] text-ink">
          Settings
        </p>

        <SettingsNav href={section} />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SettingsSectionHeader href={section} />

        <main
          id="settings-shell-content"
          data-section="settings-shell-content"
          data-testid="settings-shell-content"
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-sb shadow-sheet"
        >
          <SelectionBarSheet>
            {/*
              The prototype's inner column is `max-width:760px` under the
              browser default `content-box`, so its 16px padding sits outside
              the 760 — a 792px border box. Tailwind's reset makes everything
              `border-box`, so the cap is written as 792 to land on the same
              760px of content.
            */}
            <div className="max-w-[792px] px-4 pb-20 pt-6">{children}</div>
          </SelectionBarSheet>
        </main>
      </div>
    </div>
  )
}
