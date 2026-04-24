"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type CollectionCreateDialogProps = {
  open: boolean
  title?: string
  description?: string
  initialName?: string
  confirmLabel?: string
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<void> | void
}

export function CollectionCreateDialog({
  open,
  title = "New collection",
  description = "Create a label to organize writings across Desk, Collections, and the editor.",
  initialName = "",
  confirmLabel = "Create",
  pending = false,
  onOpenChange,
  onSubmit,
}: CollectionCreateDialogProps) {
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (open) {
      setName(initialName)
    }
  }, [initialName, open])

  const trimmedName = name.trim()
  const isDisabled = pending || trimmedName.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label htmlFor="collection-name" className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">
            Name
          </label>
          <input
            id="collection-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Collection name"
            className="h-11 w-full rounded-[10px] border-[0.5px] border-border bg-bg px-3 text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
        </div>

        <DialogFooter className="gap-2 sm:space-x-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center justify-center rounded-[10px] border-[0.5px] border-border px-4 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => void onSubmit(trimmedName)}
            className="inline-flex h-10 items-center justify-center rounded-[10px] bg-ink px-4 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
