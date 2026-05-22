export const WRITING_STATUS_VALUES = [
  "new",
  "exploring",
  "draft",
  "in_review",
  "done",
  "archived",
  "canceled",
] as const

export type WritingStatus = (typeof WRITING_STATUS_VALUES)[number]
export type LegacyWritingStatus = WritingStatus | "finished"

export const MANDATORY_WRITING_STATUSES: WritingStatus[] = ["draft"]

const WRITING_STATUS_SET = new Set<string>(WRITING_STATUS_VALUES)

export const normalizeWritingStatus = (value: string | null | undefined): WritingStatus => {
  if (value === "finished") {
    return "done"
  }

  return WRITING_STATUS_SET.has(value ?? "") ? (value as WritingStatus) : "draft"
}

export const getWritingStatusLabel = (status: LegacyWritingStatus): string => {
  switch (normalizeWritingStatus(status)) {
    case "new":
      return "New"
    case "exploring":
      return "Exploring"
    case "in_review":
      return "In Review"
    case "done":
      return "Done"
    case "archived":
      return "Archived"
    case "canceled":
      return "Canceled"
    default:
      return "Draft"
  }
}

export const isOpenWritingStatus = (status: LegacyWritingStatus): boolean => {
  const normalized = normalizeWritingStatus(status)
  return normalized !== "done" && normalized !== "archived" && normalized !== "canceled"
}

export const getWritingStatusOrder = (status: WritingStatus): number =>
  WRITING_STATUS_VALUES.indexOf(status)

export const sortWritingStatuses = (statuses: WritingStatus[]): WritingStatus[] =>
  [...statuses].sort((a, b) => getWritingStatusOrder(a) - getWritingStatusOrder(b))
