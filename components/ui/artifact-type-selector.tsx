"use client"

import { ChevronDown } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ArtifactTypeGlyph } from "@/components/desk/artifact-type-icon"
import { useVocabulary } from "@/hooks/useVocabulary"
import { listVisibleVocabulary } from "@/lib/vocabulary/resolve"
import { getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { cn } from "@/lib/utils"

type ArtifactTypeSelectorProps = {
  value: ArtifactType
  onChange: (artifactType: ArtifactType) => void
  align?: "start" | "center" | "end"
}

function ArtifactTypeItem({
  artifactType,
  selected,
  onSelect,
}: {
  artifactType: ArtifactType
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[12px] text-ink-2 transition-colors hover:bg-muted",
        selected && "font-medium text-ink",
      )}
    >
      <span className={cn("flex shrink-0 items-center text-ink-4", selected && "text-ink-2")}>
        <ArtifactTypeGlyph artifactType={artifactType} />
      </span>
      <span>{getArtifactTypeLabel(artifactType)}</span>
      {selected ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ink" /> : null}
    </button>
  )
}

export function ArtifactTypeSelector({ value, onChange, align = "start" }: ArtifactTypeSelectorProps) {
  const catalog = useVocabulary()
  const options = listVisibleVocabulary(catalog, "type")

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          <span className="flex shrink-0 items-center text-ink-3">
            <ArtifactTypeGlyph artifactType={value} />
          </span>
          <span className="flex-1 text-left">{getArtifactTypeLabel(value)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-4" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[216px] p-[5px]">
        {options.map((item) => (
          <ArtifactTypeItem
            key={item.key}
            artifactType={item.key}
            selected={item.key === value}
            onSelect={() => onChange(item.key)}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}
