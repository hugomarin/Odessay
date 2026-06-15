"use client"

import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { getWritingStatusLabel, normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

type WritingStatusBadgeVariant = "compact" | "full"

type WritingStatusBadgeProps = {
  status: WritingStatus
  variant?: WritingStatusBadgeVariant
  className?: string
}

/**
 * Canonical surface (background + text) styles for each writing status.
 * Shared so badges, status dropdowns and pills stay visually identical
 * across Desk, Workspace, Preview and any future surface.
 */
export const WRITING_STATUS_SURFACE_STYLES: Record<WritingStatus, string> = {
  new: "bg-[hsl(220,40%,94%)] text-[hsl(220,45%,42%)]",
  exploring: "bg-[hsl(35,50%,92%)] text-[hsl(35,50%,32%)]",
  draft: "bg-muted text-ink-4",
  in_review: "bg-[hsl(260,35%,94%)] text-[hsl(260,40%,40%)]",
  done: "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,30%)]",
  archived: "bg-[hsl(210,10%,92%)] text-[hsl(210,10%,40%)]",
  canceled: "bg-[hsl(0,30%,94%)] text-[hsl(0,35%,42%)]",
}

export function WritingStatusBadge({ status, variant = "full", className }: WritingStatusBadgeProps) {
  const normalized = normalizeWritingStatus(status)
  const label = getWritingStatusLabel(normalized)
  const isCompact = variant === "compact"

  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      className={cn(
        "inline-flex items-center gap-[5px] rounded-[6px] border-[0.5px] border-transparent font-sans font-medium",
        WRITING_STATUS_SURFACE_STYLES[normalized],
        isCompact ? "px-[6px] py-[2px] text-[10px]" : "px-2 py-0.5 text-[11px]",
        className,
      )}
    >
      <WritingStatusIcon
        status={normalized}
        className={isCompact ? "h-[10px] w-[10px]" : "h-[11px] w-[11px]"}
      />
      {label}
    </span>
  )
}
