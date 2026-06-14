"use client"

import { WritingStatusIcon } from "@/components/desk/writing-status-icon"
import { getWritingStatusLabel, normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

type WritingStatusBadgeVariant = "compact" | "default"

type WritingStatusBadgeProps = {
  status: WritingStatus
  variant?: WritingStatusBadgeVariant
  className?: string
}

const STATUS_BADGE_STYLES: Record<WritingStatus, string> = {
  new: "bg-[hsl(220,40%,94%)] text-[hsl(220,45%,42%)]",
  exploring: "bg-[hsl(35,50%,92%)] text-[hsl(35,50%,32%)]",
  draft: "bg-muted text-ink-4",
  in_review: "bg-[hsl(260,35%,94%)] text-[hsl(260,40%,40%)]",
  done: "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,30%)]",
  archived: "bg-[hsl(210,10%,92%)] text-[hsl(210,10%,40%)]",
  canceled: "bg-[hsl(0,30%,94%)] text-[hsl(0,35%,42%)]",
}

export function WritingStatusBadge({ status, variant = "default", className }: WritingStatusBadgeProps) {
  const normalized = normalizeWritingStatus(status)
  const label = getWritingStatusLabel(normalized)
  const isCompact = variant === "compact"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-[6px] border-[0.5px] border-transparent font-sans font-medium",
        STATUS_BADGE_STYLES[normalized],
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
