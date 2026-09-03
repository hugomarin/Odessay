import type { WritingStatus } from "@/lib/writings/status"
import type { VocabularyItem } from "@/lib/vocabulary/types"

export type UserSettings = {
  /** @deprecated derived from `vocabulary` (hidden status items) — ODE-472. */
  disabledStatuses: WritingStatus[]
  vocabulary: VocabularyItem[]
}

export const parseDisabledStatuses = (value: unknown): WritingStatus[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is WritingStatus =>
    typeof item === "string" &&
    ["new", "exploring", "draft", "in_review", "done", "archived", "canceled"].includes(item),
  )
}
