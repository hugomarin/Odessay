"use client"

import { useEffect, useState } from "react"

import { isTauriRuntime } from "@/lib/runtime/detect"
import { cn } from "@/lib/utils"

/**
 * The window-chrome row, reserved and left empty in every view but Studio.
 *
 * Studio is the only view that puts anything in this band (its tab strip, in
 * `EditorTopbar`). Desk, Workspace, Collections and Settings keep it free: the
 * traffic lights float over it on desktop, and their first line of content
 * starts underneath — never beside the lights.
 *
 * The height mirrors `sidebar-top` exactly, so the view's first line lands on
 * the same baseline as the rail's first item. Both numbers are the same pair
 * (59px under the desktop overlay title bar, 70px on the web), and they must
 * not drift apart.
 */
export function ViewTitlebarSpacer({ className }: { className?: string } = {}) {
  const [isDesktopTitlebar, setIsDesktopTitlebar] = useState(false)

  useEffect(() => {
    setIsDesktopTitlebar(isTauriRuntime())
  }, [])

  return (
    <div
      data-tauri-drag-region
      data-section="view-titlebar-spacer"
      data-testid="view-titlebar-spacer"
      aria-hidden="true"
      className={cn(
        "od-drag-region w-full flex-shrink-0",
        isDesktopTitlebar ? "h-[59px]" : "h-[70px]",
        className,
      )}
    />
  )
}
