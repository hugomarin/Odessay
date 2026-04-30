export const WRITING_STATUS_VALUES = ["new", "exploring", "draft", "done"] as const

export type WritingStatus = (typeof WRITING_STATUS_VALUES)[number]
export type LegacyWritingStatus = WritingStatus | "finished"

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
    case "done":
      return "Done"
    default:
      return "Draft"
  }
}

export const isOpenWritingStatus = (status: LegacyWritingStatus): boolean =>
  normalizeWritingStatus(status) !== "done"
