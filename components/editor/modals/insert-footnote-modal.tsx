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
import { Textarea } from "@/components/ui/textarea"

type InsertFootnoteModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (note: string) => void
}

export function InsertFootnoteModal({ open, onOpenChange, onConfirm }: InsertFootnoteModalProps) {
  const [note, setNote] = useState("")

  useEffect(() => {
    if (open) {
      setNote("")
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Insert footnote</DialogTitle>
          <DialogDescription>
            Add a note to be referenced from the current cursor position.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmedNote = note.trim()

            if (!trimmedNote) {
              return
            }

            onConfirm(trimmedNote)
            onOpenChange(false)
          }}
        >
          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">Footnote</span>
            <Textarea
              autoFocus
              rows={5}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add note text"
              required
            />
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Insert footnote</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
