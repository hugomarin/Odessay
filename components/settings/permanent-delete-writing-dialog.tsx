"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"

export function PermanentDeleteWritingDialog({ open, title, busy, onOpenChange, onConfirm }: {
  open: boolean; title: string; busy: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) requestAnimationFrame(() => cancelRef.current?.focus()) }, [open])
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
    <DialogContent hideClose aria-describedby="permanent-delete-description" onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus() }}>
      <DialogTitle>Delete “{title}” permanently?</DialogTitle>
      <DialogDescription id="permanent-delete-description">This permanently deletes the cloud copy and cannot be undone.</DialogDescription>
      <DialogFooter>
        <Button ref={cancelRef} variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete permanently"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
