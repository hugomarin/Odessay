"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { FolderPlus, Share2, Trash2 } from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CollectionOption } from "@/lib/collections/collections"

type BulkActionBarProps = {
  selectedCount: number
  visibleCount: number
  allVisibleSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDelete: () => void
  collectionOptions: CollectionOption[]
  onAddToCollection: (collectionId: string) => Promise<void> | void
  onCreateCollection: (name: string) => Promise<void> | void
  firstSelectedHref: string | null
}

export function BulkActionBar({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  onSelectAll,
  onDeselectAll,
  onDelete,
  collectionOptions,
  onAddToCollection,
  onCreateCollection,
  firstSelectedHref,
}: BulkActionBarProps) {
  const router = useRouter()
  const [shareOpen, setShareOpen] = useState(false)

  const handleShare = () => {
    if (!firstSelectedHref) return
    if (selectedCount > 1) {
      setShareOpen(true)
    } else {
      router.push(firstSelectedHref)
    }
  }

  return (
    <>
      <div
        id="desk-bulk-action-bar"
        data-section="desk-bulk-action-bar"
        data-testid="desk-bulk-action-bar"
        className="flex items-center justify-between gap-4 border-b-[0.5px] border-border bg-muted/30 px-5 py-2.5 sm:px-9"
      >
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-ink">
            {selectedCount} selected
          </span>
          {!allVisibleSelected && visibleCount > 0 ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[12px] text-ink-4 underline-offset-2 hover:text-ink-2 hover:underline"
            >
              Select all
            </button>
          ) : null}
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={onDeselectAll}
              className="text-[12px] text-ink-4 underline-offset-2 hover:text-ink-2 hover:underline"
            >
              Deselect
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <CollectionAssignmentMenu
            collections={collectionOptions}
            selectedIds={[]}
            align="end"
            title="Add to collection"
            description="Add selected writings to a collection."
            onToggleCollection={onAddToCollection}
            onCreateCollection={onCreateCollection}
            trigger={
              <button
                type="button"
                className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-border bg-sb px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted"
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Add to collection
              </button>
            }
          />

          <button
            type="button"
            onClick={handleShare}
            className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-border bg-sb px-3 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted"
          >
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            Share
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-border bg-sb px-3 text-[12px] font-medium text-[hsl(0,72%,45%)] transition-colors hover:bg-[hsl(0,72%,96%)]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            Delete
          </button>
        </div>
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Share writings</DialogTitle>
            <DialogDescription>
              Sharing {selectedCount} writings. Creating individual share links
              for each.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShareOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (firstSelectedHref) {
                  router.push(firstSelectedHref)
                }
                setShareOpen(false)
              }}
            >
              Continue with first
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
