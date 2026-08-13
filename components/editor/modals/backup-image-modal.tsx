"use client"

import { CloudUpload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type BackupImageModalProps = {
  open: boolean
  source: string | null
  uploading: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function BackupImageModal({
  open,
  source,
  uploading,
  error,
  onOpenChange,
  onConfirm,
}: BackupImageModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent className="max-w-[480px]" data-testid="backup-local-image-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudUpload className="h-[14px] w-[14px]" strokeWidth={1.5} />
            Back up image online
          </DialogTitle>
          <DialogDescription>
            The local path in this Markdown document will be replaced with an online URL. The
            original image file will remain on your computer.
          </DialogDescription>
        </DialogHeader>

        {source && (
          <p className="truncate rounded-[6px] border-[0.5px] border-border bg-muted px-3 py-2 font-mono text-[11px] text-ink-3">
            {source}
          </p>
        )}
        {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={uploading} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={uploading} onClick={onConfirm}>
            {uploading ? "Uploading…" : "Back up and replace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
