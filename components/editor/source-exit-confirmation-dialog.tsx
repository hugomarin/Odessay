"use client"

import { useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type SourceExitConfirmationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKeepEditing: () => void
  onCloseAnyway: () => void
}

export function SourceExitConfirmationDialog({
  open,
  onOpenChange,
  onKeepEditing,
  onCloseAnyway,
}: SourceExitConfirmationDialogProps) {
  const keepEditingButtonRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        aria-label="Unsaved Source changes"
        hideClose
        className="max-w-[440px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          keepEditingButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Unsaved Source changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes in Source that couldn&apos;t be converted. Close anyway?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:space-x-0">
          <Button
            ref={keepEditingButtonRef}
            type="button"
            variant="outline"
            onClick={onKeepEditing}
          >
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onCloseAnyway}>
            Close anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
