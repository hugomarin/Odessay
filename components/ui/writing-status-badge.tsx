"use client"

import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { VocabularyChip } from "@/components/ui/vocabulary-chip"
import { useVocabulary } from "@/hooks/useVocabulary"
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
 * ODE-476/icon punch pass: the "punch" chip — icon in its own tinted circle
 * (`VocabularyChip`, same component every other surface uses) — replaces the
 * tinted pill this used to be. The label stays plain text next to it, same
 * as the tab/row/table treatment elsewhere, instead of sharing a colored
 * background with the icon.
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
      className={cn(
        "inline-flex items-center gap-[6px] font-sans font-medium text-ink-2",
        isCompact ? "text-[10px]" : "text-[11px]",
        className,
      )}
    >
      <VocabularyChip color={color} size={isCompact ? 16 : 18}>
        <WritingStatusIcon
          status={normalized}
          className={isCompact ? "h-[9px] w-[9px]" : "h-[10px] w-[10px]"}
        />
      </VocabularyChip>
      {label}
    </span>
  )
}
