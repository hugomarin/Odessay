"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"

/**
 * `count` turns the single-row confirmation into the bulk one the selection bar
 * needs. `docs/design/overlays.md` requires the button to name the act, never
 * say "OK", so it stays "Delete forever" in both shapes.
 */
export function PermanentDeleteWritingDialog({ open, title, count = 1, busy, onOpenChange, onConfirm }: {
  open: boolean; title: string; count?: number; busy: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) requestAnimationFrame(() => cancelRef.current?.focus()) }, [open])

  const heading = count > 1
    ? `Delete ${count} artifacts permanently?`
    : `Delete “${title}” permanently?`

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
    <DialogContent hideClose aria-describedby="permanent-delete-description" onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus() }}>
      <DialogTitle>{heading}</DialogTitle>
      <DialogDescription id="permanent-delete-description">
        This permanently deletes the cloud {count > 1 ? "copies" : "copy"} and cannot be undone. Local files are untouched.
      </DialogDescription>
      <DialogFooter>
        <Button ref={cancelRef} variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete forever"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
