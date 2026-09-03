"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, FolderPlus, Sparkles } from "lucide-react"
import type { LocalCollection, LocalWriting } from "@/lib/local-db/schema"
import { cn } from "@/lib/utils"
import { getWritingStatusLabel } from "@/lib/writings/status"

type UncategorizedBannerProps = {
  writings: LocalWriting[]
  collections: LocalCollection[]
  selectedIds: string[]
  onToggleWriting: (writingId: string) => void
  onAssign: (collectionId: string) => Promise<void>
  onCreateCollection: (name: string) => Promise<void>
}

export function UncategorizedBanner({
  writings,
  collections,
  selectedIds,
  onToggleWriting,
  onAssign,
  onCreateCollection,
}: UncategorizedBannerProps) {
  const [open, setOpen] = useState(true)
  const [newCollectionName, setNewCollectionName] = useState("")
  const selectedCount = selectedIds.length
  const activeCollections = useMemo(
    () => collections.filter((collection) => collection.sync_status !== "deleted"),
    [collections],
  )

  if (writings.length === 0) {
    return null
  }

  return (
    <section className="overflow-hidden rounded-xl border-[0.5px] border-[hsl(22_40%_84%)] bg-[hsl(22_55%_97%)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-[hsl(22_55%_93%)] p-1.5 text-cursor">
            <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-ink-2">
              {writings.length} artifacts without a collection
            </p>
            <p className="mt-1 text-[12px] text-ink-3">
              Organize them inline. The banner disappears only when everything is classified.
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-ink-4 transition-transform duration-200",
            open ? "rotate-180" : "rotate-0",
          )}
          strokeWidth={1.5}
        />
      </button>

      {open ? (
        <div className="border-t-[0.5px] border-[hsl(22_40%_88%)] bg-[hsl(22_55%_95%)]">
          <div className="flex flex-wrap items-center gap-2 border-b-[0.5px] border-[hsl(22_40%_88%)] px-4 py-3">
            <span className="text-[12px] text-ink-4">{selectedCount} selected</span>
            {activeCollections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => void onAssign(collection.id)}
                disabled={selectedCount === 0}
                className="rounded-md border-[0.5px] border-[hsl(22_40%_82%)] bg-bg px-3 py-1.5 text-[12px] font-medium text-cursor transition-colors hover:bg-[hsl(22_55%_93%)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add to {collection.name}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <input
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
                placeholder="New collection"
                className="h-8 rounded-md border-[0.5px] border-border bg-bg px-3 text-[12px] text-ink outline-none placeholder:text-ink-4"
              />
              <button
                type="button"
                disabled={selectedCount === 0 || newCollectionName.trim().length === 0}
                onClick={() => {
                  void onCreateCollection(newCollectionName.trim())
                  setNewCollectionName("")
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-ink px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Create
              </button>
            </div>
          </div>

          <div className="divide-y divide-[hsl(22_40%_90%)]">
            {writings.map((writing) => {
              const selected = selectedIds.includes(writing.id)

              return (
                <button
                  key={writing.id}
                  type="button"
                  onClick={() => onToggleWriting(writing.id)}
                  className={cn(
                    "grid w-full grid-cols-[32px_1fr] gap-3 px-4 py-4 text-left transition-colors hover:bg-[hsl(22_55%_96%)]",
                    selected ? "bg-[hsl(22_55%_94%)]" : "",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-border bg-bg",
                      selected ? "border-cursor bg-cursor text-bg" : "text-transparent",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-lora text-[15px] text-ink">
                      {writing.title ?? "Untitled"}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-ink-3">
                      {writing.body_text.trim() || "No content yet."}
                    </span>
                    <span className="mt-2 block text-[11px] text-ink-4">{getWritingStatusLabel(writing.status)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}
