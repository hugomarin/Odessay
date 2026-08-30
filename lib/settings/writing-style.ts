export const WRITING_STYLE_VALUES = ["quine", "kant", "descartes"] as const

export type WritingStyle = (typeof WRITING_STYLE_VALUES)[number]

export type WritingStyleOption = {
  value: WritingStyle
  philosopher: string
  descriptor: string
  label: string
}

export const DEFAULT_WRITING_STYLE: WritingStyle = "kant"
export const WRITING_STYLE_STORAGE_KEY = "odessay:writing-style"

export const WRITING_STYLE_OPTIONS: WritingStyleOption[] = [
  {
    value: "quine",
    philosopher: "Quine",
    descriptor: "Contemporary",
    label: "Quine · Contemporary",
  },
  {
    value: "kant",
    philosopher: "Kant",
    descriptor: "Balanced",
    label: "Kant · Balanced",
  },
  {
    value: "descartes",
    philosopher: "Descartes",
    descriptor: "Classic",
    label: "Descartes · Classic",
  },
]

export function parseWritingStyle(value: unknown): WritingStyle {
  return typeof value === "string" && WRITING_STYLE_VALUES.includes(value as WritingStyle)
    ? (value as WritingStyle)
    : DEFAULT_WRITING_STYLE
}

export function getWritingStyleOption(value: WritingStyle): WritingStyleOption {
  return WRITING_STYLE_OPTIONS.find((option) => option.value === value) ?? WRITING_STYLE_OPTIONS[1]
}
