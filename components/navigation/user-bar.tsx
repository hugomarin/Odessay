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
      className="SidebarBottom px-2 py-2"
    >
      <ActionTooltip label="Settings" shortcut={getEditorShortcutLabel("settings")} side="right">
        <Link
          href="/settings"
          className={cn(
            "flex items-center rounded-md border-[0.5px] border-transparent px-2 py-[6px] text-ink-2 transition-colors hover:border-border hover:bg-muted/70 hover:text-ink",
            collapsed ? "justify-center px-0" : "justify-between",
          )}
          aria-label="Settings"
        >
          <div className={cn("flex min-w-0 items-center", collapsed ? "justify-center" : "gap-2")}>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-bg">
              {initials || "OD"}
            </span>

            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{displayName}</span>
                <span className="block truncate text-[11px] text-ink-4">@{username}</span>
              </span>
            ) : null}
          </div>

          {!collapsed ? (
            <span className="flex items-center gap-1 text-ink-4">
              <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </span>
          ) : null}
        </Link>
      </ActionTooltip>
    </div>
  )
}
