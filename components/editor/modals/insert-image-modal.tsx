"use client"

import { useEffect, useRef, useState } from "react"
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
import { getAssetService } from "@/lib/services/asset-service-factory"

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]
const MAX_SIZE = 5 * 1024 * 1024

type InsertImageModalProps = {
  open: boolean
  writingId: string
  onOpenChange: (open: boolean) => void
  onConfirm: (payload: { src: string; alt: string }) => void
}

export function InsertImageModal({ open, writingId, onOpenChange, onConfirm }: InsertImageModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [alt, setAlt] = useState("")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFile(null)
      setAlt("")
      setUploading(false)
      setError(null)
    }
  }, [open])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null
    if (!selected) return

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError("Invalid file type. Allowed: png, jpg, jpeg, webp, gif.")
      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
      return
    }

    if (selected.size > MAX_SIZE) {
      setError("File too large. Maximum size is 5MB.")
      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
      return
    }

    setError(null)
    setFile(selected)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !writingId) return

    setUploading(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await getAssetService().uploadImageAsset({
        writingId,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        bytes,
        alt: alt.trim() || null,
      })

      if (result.error) {
        setError(result.error.message || "Failed to upload image. Please try again.")
        return
      }

      onConfirm({ src: result.data.url, alt: alt.trim() })
      onOpenChange(false)
    } catch {
      setError("Failed to upload image. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Insert image</DialogTitle>
          <DialogDescription>Upload an image from your device.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">Image file</span>
            <Input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              onChange={handleFileChange}
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">Alt text (optional)</span>
            <Input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Describe the image"
              maxLength={500}
            />
          </label>

          {error && (
            <p className="text-[13px] text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" disabled={!file || uploading}>
              {uploading ? "Uploading..." : "Insert image"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
