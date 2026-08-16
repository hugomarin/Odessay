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
  /**
   * `preview` is the field button the Desk prototype draws in the preview's
   * properties column: 38px on the sheet colour, not 40px on the canvas.
   */
  variant?: "table" | "rail" | "preview"
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
  "items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-3 text-[13px] font-medium text-ink-2"

/** The preview column's field button, read from the Desk prototype. */
const PREVIEW_CHROME =
  "items-center justify-between gap-[9px] rounded-[8px] border-[0.5px] border-border bg-sb px-[11px] text-[13px] font-normal text-ink-2"

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
  const sizing =
    variant === "preview"
      ? "flex h-[38px] w-full"
      : variant === "rail"
        ? "flex h-10 w-full"
        : "inline-flex h-10 w-full min-w-[136px]"
  const chrome = variant === "preview" ? PREVIEW_CHROME : TRIGGER_CHROME

  if (readOnly) {
    return (
      <div
        aria-label={ariaLabel}
        className={cn(chrome, sizing, "cursor-default", className)}
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
            chrome,
            variant === "preview"
              ? "transition-colors hover:border-ink-6 hover:bg-surface-row-hover data-[state=open]:border-ink-5 data-[state=open]:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
              : "transition-colors hover:bg-muted data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
            sizing,
            className,
          )}
        >
          <span className={cn("flex min-w-0 items-center", variant === "preview" ? "gap-[9px]" : "gap-2")}>
            {icon}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown
            className={cn("shrink-0 text-ink-4", variant === "preview" ? "h-3.5 w-3.5" : "h-3 w-3")}
            strokeWidth={1.5}
          />
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
