"use client"

import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getLocalDBScope } from "@/lib/local-db"
import { enqueueWritingUpsert } from "@/lib/sync/queue"
import { getSyncService } from "@/lib/sync"
import { parseMarkdownFile } from "@/lib/import/markdown"
import { parsePlainTextFile } from "@/lib/import/text"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import type { LocalWriting } from "@/lib/local-db/schema"

const MD_EXT = ".md"
const TXT_EXT = ".txt"
const ACCEPTED_TYPES = [MD_EXT, TXT_EXT]

const UNSUPPORTED_ERR = "Unsupported file type. Please select a .md or .txt file."
const IMPORT_FAIL_ERR = "Import failed. Please try again."
const DRAFT_STATUS = "draft" as const
const PRIVATE_VIS = "private" as const
const PENDING_SYNC = "pending" as const
const LOCAL_LIFECYCLE = "local-only" as const
const ANON_SCOPE = "anonymous"
const EMPTY_VAL = ""
const ACCEPT_ATTR = ".md,.txt,text/markdown,text/plain"
const DROP_ARIA_LABEL = "Drop a file here or click to browse"
const DROP_HINT_TEXT = "Drop a .md or .txt file here"
const BROWSE_LABEL = "Browse files"
const IMPORTING_LABEL = "Importing..."

const DIALOG_CLS = "ImportWritingDialog max-w-[400px]"
const TITLE_CLS = "font-lora text-[17px] font-normal text-ink"
const DROP_ZONE_BASE = "mt-2 flex cursor-pointer flex-col items-center gap-3 rounded-lg border-[0.5px] px-6 py-8 transition-colors"
const DROP_ZONE_ACTIVE_CLS = DROP_ZONE_BASE + " border-ink-3 bg-muted"
const DROP_ZONE_IDLE_CLS = DROP_ZONE_BASE + " border-border bg-bg hover:border-ink-4 hover:bg-muted"
const ICON_CLS = "h-[18px] w-[18px] text-ink-4"
const HINT_CLS = "text-center text-[13px] text-ink-3"
const BTN_CLS = "h-7 px-3 text-[12px] text-ink-3 hover:text-ink-2"
const ERROR_CLS = "mt-1 text-[12px] text-destructive"

const isAcceptedFile = (file: File): boolean => {
  const lower = file.name.toLowerCase()
  return ACCEPTED_TYPES.some((ext) => lower.endsWith(ext))
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportWritingDialog({ open, onOpenChange }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const importFile = async (file: File) => {
    setError(null)

    if (!isAcceptedFile(file)) {
      setError(UNSUPPORTED_ERR)
      return
    }

    setIsImporting(true)

    try {
      const lower = file.name.toLowerCase()
      const result = lower.endsWith(MD_EXT)
        ? await parseMarkdownFile(file)
        : await parsePlainTextFile(file)

      const now = new Date().toISOString()
      const nowMs = Date.now()
      const id = crypto.randomUUID()
      const scope = getLocalDBScope()

      const writing: LocalWriting = {
        id,
        author_id: scope === ANON_SCOPE ? null : scope,
        title: result.title,
        body_json: result.body_json,
        body_text: result.body_text,
        slug: null,
        status: DRAFT_STATUS,
        visibility: PRIVATE_VIS,
        parent_id: null,
        correspondence_id: null,
        version: 1,
        sync_status: PENDING_SYNC,
        lifecycle: LOCAL_LIFECYCLE,
        deleted_at: null,
        created_at: now,
        updated_at: now,
        local_updated_at: nowMs,
      }

      await enqueueWritingUpsert(writing)
      void getSyncService().scheduleFlush()

      onOpenChange(false)
      router.push(buildWritingRouteHref("/write", { id, slug: null }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : IMPORT_FAIL_ERR
      setError(msg)
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void importFile(file)
    }
    e.target.value = EMPTY_VAL
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      void importFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleBrowseClick = () => {
    fileInputRef.current?.click()
  }

  const dropZoneCls = isDragging ? DROP_ZONE_ACTIVE_CLS : DROP_ZONE_IDLE_CLS

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="import-writing-dialog"
        data-section="import-writing-dialog"
        className={DIALOG_CLS}
      >
        <DialogHeader>
          <DialogTitle className={TITLE_CLS}>
            Import an artifact
          </DialogTitle>
        </DialogHeader>

        <div
          className={dropZoneCls}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleBrowseClick}
          role="button"
          aria-label={DROP_ARIA_LABEL}
        >
          <Upload
            className={ICON_CLS}
            strokeWidth={1.5}
          />
          <p className={HINT_CLS}>
            {DROP_HINT_TEXT}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className={BTN_CLS}
            onClick={(e) => {
              e.stopPropagation()
              handleBrowseClick()
            }}
            disabled={isImporting}
          >
            {isImporting ? IMPORTING_LABEL : BROWSE_LABEL}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={handleFileChange}
            aria-hidden
          />
        </div>

        {error && (
          <p
            className={ERROR_CLS}
            role="alert"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
