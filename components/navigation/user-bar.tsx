import Link from "next/link"
import { ChevronRight, Settings } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { cn } from "@/lib/utils"

type UserBarProps = {
  collapsed: boolean
  displayName: string
  username: string
}

export function UserBar({ collapsed, displayName, username }: UserBarProps) {
  const initials = displayName
    .split(" ")
    .map((chunk) => chunk[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      id="sidebar-bottom"
      data-section="sidebar-bottom"
      data-testid="sidebar-bottom"
      /*
        No horizontal padding here. The prototypes hang the account row directly
        off the rail column with `padding-left: 6px` and nothing on the right —
        nesting it inside another 6px and adding a right padding is what squeezed
        the 36px avatar into a 26px content box and clipped it at 52px.
      */
      className="SidebarBottom pb-1.5"
    >
      {/*
        The prototypes' account row: 46px tall at radius 9, 10px gaps, 6px of
        leading padding, and a **36px** avatar — the repo drew 28. Name 13/500,
        handle 11/400, and both trailing glyphs at 15px. Like every other rail
        row, the avatar's X position is the same collapsed and expanded.
      */}
      <ActionTooltip label="Settings" shortcut={getEditorShortcutLabel("settings")} side="right">
        <Link
          href="/settings"
          className={cn(
            // 6px of leading padding + the avatar's own 2px puts its centre at
            // 26px — the same X as every rail icon above it, in both states.
            "flex h-[46px] w-full items-center gap-2.5 overflow-hidden rounded-[9px] pl-[6px]",
            "text-ink-2 transition-colors duration-[180ms] hover:bg-muted hover:text-ink",
          )}
          aria-label="Settings"
        >
          <span
            data-testid="sidebar-user-avatar"
            className="mx-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold leading-none text-bg"
          >
            {initials || "OD"}
          </span>

          <span
            className={cn(
              "min-w-0 flex-1 overflow-hidden transition-opacity duration-200 ease-out",
              collapsed ? "opacity-0" : "opacity-100",
            )}
          >
            <span className="block truncate text-[13px] font-medium leading-[1.35] text-ink">
              {displayName}
            </span>
            <span className="block truncate text-[11px] leading-[1.4] text-ink-4">@{username}</span>
          </span>

          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-ink-4 transition-opacity duration-200 ease-out",
              collapsed ? "opacity-0" : "opacity-100",
            )}
          >
            <Settings className="h-[15px] w-[15px]" strokeWidth={1.5} />
            <ChevronRight className="h-[15px] w-[15px]" strokeWidth={1.5} />
          </span>
        </Link>
      </ActionTooltip>
    </div>
  )
}
