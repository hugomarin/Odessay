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
}

export function DeleteWritingDialog({ open, onOpenChange, onConfirm, count = 1, title }: DeleteWritingDialogProps) {
  const displayTitle = title?.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {displayTitle
              ? `Delete “${displayTitle}”?`
              : `Delete ${count === 1 ? "writing" : `${count} writings`}`}
          </DialogTitle>
          <DialogDescription>
            {displayTitle
              ? "This action can't be undone."
              : `Are you sure you want to delete ${count === 1 ? "this writing" : `these ${count} writings`}? This action cannot be undone.`}
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
