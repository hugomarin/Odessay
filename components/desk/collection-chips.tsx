"use client"

import { useRouter } from "next/navigation"
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
        const handleClick = (event: React.MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          if (onSelect) {
            onSelect(id)
            return
          }
          router.push(`/collections/${encodeURIComponent(id)}`)
        }

        return (
          <button
            key={id}
            type="button"
            onClick={handleClick}
            className="inline-flex max-w-[90px] items-center rounded-[6px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-[7px] py-[2px] text-[10px] font-medium text-[hsl(28_22%_22%)] transition-colors hover:bg-[hsl(34_30%_88%)]"
          >
            <span className="truncate">{collection?.name ?? id}</span>
          </button>
        )
      })}
      {overflow > 0 ? (
        <span className="shrink-0 text-[10px] text-ink-4">+{overflow}</span>
      ) : null}
    </div>
  )
}
