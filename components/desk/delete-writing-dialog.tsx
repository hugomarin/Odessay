"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type DeleteWritingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  count?: number
  title?: string
  scope?: "cloud" | "writing"
}

export function DeleteWritingDialog({
  open,
  onOpenChange,
  onConfirm,
  count = 1,
  title,
  scope = "writing",
}: DeleteWritingDialogProps) {
  const displayTitle = title?.trim()
  const targetLabel = count === 1 ? "writing" : `${count} writings`
  const isCloudDelete = scope === "cloud"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {displayTitle
              ? `Delete ${isCloudDelete ? "cloud record for " : ""}“${displayTitle}”?`
              : `Delete ${isCloudDelete ? "cloud records for " : ""}${targetLabel}`}
          </DialogTitle>
          <DialogDescription>
            {isCloudDelete
              ? "This permanently deletes the cloud record. Deleting the local .md file separately only removes the local copy and keeps the cloud record."
              : displayTitle
                ? "This action can't be undone."
                : `Are you sure you want to delete ${count === 1 ? "this artifact" : `these ${count} artifacts`}? This action cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
