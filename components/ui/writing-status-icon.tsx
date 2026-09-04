"use client"

import { VocabularyIcon } from "@/components/settings/vocabulary-icon"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getVocabularyIconName } from "@/lib/vocabulary/resolve"
import type { WritingStatus } from "@/lib/writings/status"

type WritingStatusIconProps = {
  status: WritingStatus
  className?: string
}

/** Resolves from the shared vocabulary catalog (ODE-474) — no per-status switch. */
export function WritingStatusIcon({ status, className = "h-[13px] w-[13px]" }: WritingStatusIconProps) {
  const catalog = useVocabulary()
  const name = getVocabularyIconName(catalog, "status", status) ?? "circle"
  const sizeMatch = /(?:h|w)-\[(\d+)px\]/.exec(className)
  const size = sizeMatch ? Number(sizeMatch[1]) : 13

  return <VocabularyIcon name={name} size={size} className={className} />
}
