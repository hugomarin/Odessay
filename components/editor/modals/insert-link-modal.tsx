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

type InsertLinkModalProps = {
  open: boolean
  initialText: string
  onOpenChange: (open: boolean) => void
  onConfirm: (payload: { text: string; url: string }) => void
}

const normalizeUrl = (url: string) => {
  if (!url) {
    return url
  }

  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
    return url
  }

  return `https://${url}`
}

export function InsertLinkModal({ open, initialText, onOpenChange, onConfirm }: InsertLinkModalProps) {
  const [text, setText] = useState(initialText)
  const [url, setUrl] = useState("")

  useEffect(() => {
    if (open) {
      setText(initialText)
      setUrl("")
    }
  }, [open, initialText])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Insert link</DialogTitle>
          <DialogDescription>Attach a URL to the current selection or insert a linked text.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const normalizedUrl = normalizeUrl(url.trim())

            if (!normalizedUrl) {
              return
            }

            onConfirm({ text: text.trim(), url: normalizedUrl })
            onOpenChange(false)
          }}
        >
          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">Text (optional)</span>
            <Input
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Selected text"
              maxLength={320}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[12px] font-medium text-ink-3">URL</span>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              required
            />
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Insert link</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
