"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type RenameWritingModalProps = {
  open: boolean
  title: string
  onOpenChange: (open: boolean) => void
  onConfirm: (title: string) => void
}

export function RenameWritingModal({ open, title, onOpenChange, onConfirm }: RenameWritingModalProps) {
  const [nextTitle, setNextTitle] = useState(title)

  useEffect(() => {
    if (open) {
      setNextTitle(title)
    }
  }, [open, title])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Rename writing</DialogTitle>
          <DialogDescription>Update the title shown in the editor topbar and desk.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm(nextTitle.trim() || "Untitled writing")
            onOpenChange(false)
          }}
        >
          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">Title</span>
            <Input
              autoFocus
              value={nextTitle}
              onChange={(event) => setNextTitle(event.target.value)}
              placeholder="Untitled writing"
              maxLength={160}
            />
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save title</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
