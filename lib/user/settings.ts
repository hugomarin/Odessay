import type { WritingStatus } from "@/lib/writings/status"

export type UserSettings = {
  disabledStatuses: WritingStatus[]
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
