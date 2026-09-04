"use client"

import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getStatusChipTint } from "@/lib/settings/vocabulary"
import { getVocabularyColor } from "@/lib/vocabulary/resolve"
import { getWritingStatusLabel, normalizeWritingStatus, type WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

type WritingStatusBadgeVariant = "compact" | "full"

type WritingStatusBadgeProps = {
  status: WritingStatus
  variant?: WritingStatusBadgeVariant
  className?: string
}

/**
 * ODE-476: background and text derive from the catalog color through the one
 * tint formula the app uses everywhere (`getStatusChipTint`) — no per-status
 * Tailwind table. Requirement 3: the tint rule is the same rule everywhere,
 * not a second lookup table per component.
 */
export function WritingStatusBadge({ status, variant = "full", className }: WritingStatusBadgeProps) {
  const catalog = useVocabulary()
  const normalized = normalizeWritingStatus(status)
  const label = getWritingStatusLabel(normalized)
  const color = getVocabularyColor(catalog, "status", normalized)
  const isCompact = variant === "compact"

  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      style={{ background: getStatusChipTint(color), color }}
      className={cn(
        "inline-flex items-center gap-[5px] rounded-[6px] border-[0.5px] border-transparent font-sans font-medium",
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
