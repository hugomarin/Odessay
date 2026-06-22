"use client"

import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type TablePropertySelectorProps = {
  ariaLabel: string
  icon: ReactNode
  label: ReactNode
  /** Dropdown content. Optional in `readOnly` mode, where the control is static. */
  children?: ReactNode
  variant?: "table" | "rail"
  /**
   * Render the control as a non-interactive label that keeps the exact Desk chrome
   * (background, border, height, icon + label) but drops the dropdown and chevron.
   * Used by surfaces whose property is fixed by the domain (e.g. a local workspace
   * file has no editable status), so they share this control instead of ad-hoc pills.
   */
  readOnly?: boolean
  className?: string
  contentClassName?: string
  onClick?: (event: { stopPropagation: () => void }) => void
}

/** Chrome shared by the interactive trigger and the read-only label so they match exactly. */
const TRIGGER_CHROME =
  "items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[13px] font-medium text-ink-2"

/**
 * Shared table property control for status, artifact type, and workspace.
 * The open state supplies the muted surface used by the Desk reference.
 */
export function TablePropertySelector({
  ariaLabel,
  icon,
  label,
  children,
  className,
  contentClassName,
  onClick,
  variant = "table",
  readOnly = false,
}: TablePropertySelectorProps) {
  const sizing = variant === "rail" ? "flex h-10 w-full" : "inline-flex h-9 w-fit min-w-[116px]"

  if (readOnly) {
    return (
      <div
        aria-label={ariaLabel}
        className={cn(TRIGGER_CHROME, sizing, "cursor-default", className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            TRIGGER_CHROME,
            "transition-colors hover:bg-muted data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
            sizing,
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("rounded-[18px] p-2 shadow-float-md", contentClassName)}
        onClick={onClick}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
