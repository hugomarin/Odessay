"use client"

import { useState } from "react"
import { Check, ChevronDown, Type } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useWritingStyle } from "@/hooks/use-writing-style"
import {
  getWritingStyleOption,
  WRITING_STYLE_OPTIONS,
  type WritingStyle,
} from "@/lib/settings/writing-style"
import { cn } from "@/lib/utils"

type WritingStyleSelectorProps = {
  align?: "start" | "center" | "end"
}

function WritingStyleItem({
  style,
  selected,
  onSelect,
}: {
  style: WritingStyle
  selected: boolean
  onSelect: () => void
}) {
  const option = getWritingStyleOption(style)

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "WritingStyleSelectorItem flex min-h-[38px] w-full items-center gap-2 rounded-[6px] px-[10px] py-1.5 text-left transition-colors hover:bg-muted",
        selected && "bg-surface-selected",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-[12px] text-ink-2", selected && "font-medium text-ink")}>
          {option.philosopher}
        </span>
        <span className="text-[10px] leading-[1.35] text-ink-4">{option.descriptor}</span>
      </span>
      {selected ? <Check className="h-3 w-3 shrink-0 text-ink-3" strokeWidth={1.5} /> : null}
    </button>
  )
}

export function WritingStyleSelector({ align = "start" }: WritingStyleSelectorProps) {
  const [open, setOpen] = useState(false)
  const [writingStyle, setWritingStyle] = useWritingStyle()
  const selectedOption = getWritingStyleOption(writingStyle)

  const handleSelect = (style: WritingStyle) => {
    setWritingStyle(style)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="writing-style-selector"
          aria-label="Artifact style"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="writing-style-options"
          className={cn(
            "WritingStyleSelector flex h-8 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted",
            open && "border-ink-3 bg-sb",
          )}
        >
          <Type className="h-[13px] w-[13px] shrink-0 text-ink-3" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate text-left">{selectedOption.label}</span>
          <ChevronDown
            className={cn("h-3 w-3 shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
            strokeWidth={1.5}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id="writing-style-options"
        align={align}
        role="listbox"
        aria-label="Artifact style"
        className="WritingStyleSelectorOptions w-[216px] p-[5px]"
      >
        {WRITING_STYLE_OPTIONS.map((option) => (
          <WritingStyleItem
            key={option.value}
            style={option.value}
            selected={option.value === writingStyle}
            onSelect={() => handleSelect(option.value)}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}
