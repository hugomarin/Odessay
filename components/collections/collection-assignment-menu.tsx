"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Check, FolderPlus, X } from "lucide-react"
import { CollectionCreateDialog } from "@/components/collections/collection-create-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { CollectionOption } from "@/lib/collections/collections"
import { cn } from "@/lib/utils"

type CollectionAssignmentMenuProps = {
  collections: CollectionOption[]
  selectedIds: string[]
  align?: "start" | "center" | "end"
  trigger: ReactNode
  title?: string
  description?: string
  onToggleCollection: (collectionId: string) => Promise<void> | void
  onCreateCollection: (name: string) => Promise<void> | void
}

export function CollectionAssignmentMenu({
  collections,
  selectedIds,
  align = "end",
  trigger,
  title = "Add to collections",
  description = "Choose one or more labels. Changes apply immediately.",
  onToggleCollection,
  onCreateCollection,
}: CollectionAssignmentMenuProps) {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const selectedCollections = useMemo(
    () => collections.filter((collection) => selectedIds.includes(collection.id)),
    [collections, selectedIds],
  )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align={align} className="z-[70] w-[280px] p-0">
          <div className="border-b-[0.5px] border-border px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[13px] font-medium text-ink">{title}</p>
                <p className="text-[11px] leading-relaxed text-ink-4">{description}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                aria-label="Close collections picker"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {selectedCollections.length > 0 ? (
                selectedCollections.map((collection) => (
                  <span
                    key={collection.id}
                    className="rounded-[13px] border-[0.5px] border-border bg-muted px-2 py-0.5 text-[11px] text-ink-3"
                  >
                    {collection.name}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-ink-4">No collections selected yet.</span>
              )}
            </div>

            <div className="space-y-1">
              {collections.length > 0 ? (
                collections.map((collection) => {
                  const selected = selectedIds.includes(collection.id)

                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => void onToggleCollection(collection.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[8px] border-[0.5px] px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-ink bg-muted text-ink"
                          : "border-border bg-sb text-ink-2 hover:bg-muted/70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px]",
                            selected
                              ? "border-ink bg-ink text-bg"
                              : "border-border bg-sb text-transparent",
                          )}
                        >
                          <Check className="h-3 w-3" strokeWidth={2.2} />
                        </span>
                        <span className="text-[12px]">{collection.name}</span>
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="rounded-[8px] border-[0.5px] border-dashed border-border px-3 py-3 text-[12px] text-ink-4">
                  Create your first collection to start labeling writings.
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-[8px] border-[0.5px] border-dashed border-border px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted"
            >
              <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
              New collection
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 items-center rounded-[8px] bg-ink px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90"
            >
              Close
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <CollectionCreateDialog
        open={createOpen}
        pending={isCreating}
        onOpenChange={setCreateOpen}
        onSubmit={async (name) => {
          setIsCreating(true)
          try {
            await onCreateCollection(name)
            setCreateOpen(false)
          } finally {
            setIsCreating(false)
          }
        }}
      />
    </>
  )
}
