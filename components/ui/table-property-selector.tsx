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
  children: ReactNode
  className?: string
  contentClassName?: string
  onClick?: (event: { stopPropagation: () => void }) => void
}

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
}: TablePropertySelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex h-9 w-fit min-w-[116px] items-center justify-between gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted data-[state=open]:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3",
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
