"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ChevronDown, FolderPlus, Share2, Trash2 } from "lucide-react"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { CollectionOption } from "@/lib/collections/collections"
import { getWritingStatusLabel, type WritingStatus, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { WritingStatusIcon } from "@/components/desk/writing-status-icon"
import { cn } from "@/lib/utils"

type BulkActionBarProps = {
  selectedCount: number
  visibleCount: number
  allVisibleSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDelete: () => void
  onStatusChange: (status: WritingStatus) => Promise<void> | void
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
  onStatusChange,
  collectionOptions,
  onAddToCollection,
  onCreateCollection,
  firstSelectedHref,
}: BulkActionBarProps) {
  const router = useRouter()
  const [shareOpen, setShareOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

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
        className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center justify-between gap-4 rounded-[10px] border-[0.5px] border-ink bg-ink px-4 py-2.5 text-bg shadow-float-md"
      >
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-bg">
            {selectedCount} selected
          </span>
          {!allVisibleSelected && visibleCount > 0 ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[12px] text-bg/55 underline-offset-2 hover:text-bg hover:underline"
            >
              Select all
            </button>
          ) : null}
          {selectedCount > 0 ? (
            <button
              type="button"
              onClick={onDeselectAll}
              className="text-[12px] text-bg/55 underline-offset-2 hover:text-bg hover:underline"
            >
              Deselect
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-bg/15 bg-bg/5 px-3 text-[12px] font-medium text-bg transition-colors hover:bg-bg/10",
                  statusOpen && "border-bg/35 bg-bg/10",
                )}
              >
                <WritingStatusIcon status="draft" className="h-[13px] w-[13px] text-bg/70" />
                Change status
                <ChevronDown
                  className={cn("h-3 w-3 text-bg/60 transition-transform", statusOpen && "rotate-180")}
                  strokeWidth={1.5}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[180px] p-[5px]">
              {WRITING_STATUS_VALUES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    void onStatusChange(status)
                    setStatusOpen(false)
                  }}
                  className="flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[12px] text-ink-2 transition-colors hover:bg-muted"
                >
                  <WritingStatusIcon status={status} />
                  <span>{getWritingStatusLabel(status)}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>

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
                className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-bg/15 bg-bg/5 px-3 text-[12px] font-medium text-bg transition-colors hover:bg-bg/10"
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Add to collection
              </button>
            }
          />

          <button
            type="button"
            onClick={handleShare}
            className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-bg/15 bg-bg/5 px-3 text-[12px] font-medium text-bg transition-colors hover:bg-bg/10"
          >
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            Share
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-[hsl(0,72%,58%)]/40 bg-[hsl(0,72%,45%)]/15 px-3 text-[12px] font-medium text-[hsl(0,80%,78%)] transition-colors hover:bg-[hsl(0,72%,45%)]/25"
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
