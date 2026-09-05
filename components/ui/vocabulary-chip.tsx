import type { ComponentPropsWithoutRef } from "react"
import { getStatusChipTint } from "@/lib/settings/vocabulary"
import { cn } from "@/lib/utils"

/**
 * A circular tint chip behind a vocabulary icon — the "punch" treatment
 * already used in Settings' vocabulary list rows (`vocabulary-list.tsx`),
 * pulled out so any other surface can drop an icon into the same colored
 * circle instead of rendering it bare. Same tint formula everywhere
 * (`getStatusChipTint` — the name predates this component but the formula
 * was never status-specific).
 */
export function VocabularyChip({
  color,
  size = 22,
  className,
  style,
  children,
  ...rest
}: {
  color: string
  size?: number
} & ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{ width: size, height: size, background: getStatusChipTint(color), color, ...style }}
      {...rest}
    >
      {children}
    </span>
  )
}
