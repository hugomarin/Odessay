"use client"

import { useRouter } from "next/navigation"
import { Tag } from "lucide-react"
import type { CollectionOption } from "@/lib/collections/collections"
import { cn } from "@/lib/utils"

type CollectionChipsProps = {
  collectionIds: string[]
  collectionOptions: CollectionOption[]
  limit?: number
  onSelect?: (id: string) => void
  className?: string
}

export function CollectionChips({
  collectionIds,
  collectionOptions,
  limit = 2,
  onSelect,
  className,
}: CollectionChipsProps) {
  const router = useRouter()
  const optionById = new Map(collectionOptions.map((option) => [option.id, option]))
  const visible = collectionIds.slice(0, limit)
  const overflow = collectionIds.length - limit

  if (collectionIds.length === 0) {
    return null
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      {visible.map((id) => {
        const collection = optionById.get(id)
        const handleClick = (event: React.MouseEvent | React.KeyboardEvent) => {
          event.preventDefault()
          event.stopPropagation()
          if (onSelect) {
            onSelect(id)
            return
          }
          router.push(`/collections/${encodeURIComponent(id)}`)
        }

        const handleKeyDown = (event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            handleClick(event)
          }
        }

        return (
          <span
            key={id}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className="inline-flex max-w-[104px] cursor-pointer items-center gap-1 rounded-[6px] border-[0.5px] border-border bg-muted/60 px-[7px] py-[3px] text-[10px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
          >
            <Tag className="h-[10px] w-[10px] shrink-0 text-ink-4" strokeWidth={1.5} />
            <span className="truncate">{collection?.name ?? id}</span>
          </span>
        )
      })}
      {overflow > 0 ? (
        <span className="shrink-0 text-[10px] text-ink-4">+{overflow}</span>
      ) : null}
    </div>
  )
}
