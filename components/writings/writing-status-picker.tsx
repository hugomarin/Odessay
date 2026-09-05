"use client"

import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { WritingStatus } from "@/lib/writings/status"
import { getWritingStatusLabel } from "@/lib/writings/status"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { VocabularyChip } from "@/components/ui/vocabulary-chip"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getVocabularyColor, listVisibleVocabulary } from "@/lib/vocabulary/resolve"
import { cn } from "@/lib/utils"

type WritingStatusPickerProps = {
  value: WritingStatus
  onChange: (status: WritingStatus) => void
  enabledStatuses?: WritingStatus[]
  align?: "start" | "center" | "end"
  children?: ReactNode
  className?: string
  contentClassName?: string
}

function StatusPickerItem({
  status,
  selected,
  onSelect,
}: {
  status: WritingStatus
  selected: boolean
  onSelect: () => void
}) {
  const catalog = useVocabulary()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[12px] text-ink-2 transition-colors hover:bg-muted",
        selected && "font-medium text-ink",
      )}
    >
      <VocabularyChip color={getVocabularyColor(catalog, "status", status)} size={20}>
        <WritingStatusIcon status={status} className="h-[12px] w-[12px]" />
      </VocabularyChip>
      <span>{getWritingStatusLabel(status)}</span>
      {selected ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ink" /> : null}
    </button>
  )
}

export function WritingStatusPicker({
  value,
  onChange,
  enabledStatuses,
  align = "start",
  children,
  className,
  contentClassName,
}: WritingStatusPickerProps) {
  const catalog = useVocabulary()
  const availableStatuses = enabledStatuses ?? listVisibleVocabulary(catalog, "status").map((item) => item.key)

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children ?? (
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted",
              className,
            )}
          >
            <VocabularyChip color={getVocabularyColor(catalog, "status", value)} size={20}>
              <WritingStatusIcon status={value} className="h-[12px] w-[12px]" />
            </VocabularyChip>
            <span className="flex-1 text-left">{getWritingStatusLabel(value)}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-[216px] p-[5px]", contentClassName)}>
        {availableStatuses.map((status) => (
          <StatusPickerItem
            key={status}
            status={status}
            selected={status === value}
            onSelect={() => onChange(status)}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}
