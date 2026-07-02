"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Clipboard,
  ChevronDown,
  Circle,
  Download,
  ExternalLink,
  FileText,
  FileType,
  LayoutTemplate,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  Tag,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu"
import { WorkspaceAssignmentDropdown } from "@/components/desk/workspace-assignment-dropdown"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { WritingContentFrame } from "@/components/reading/writing-content-frame"
import { AnnotationsPreview } from "@/components/preview/annotations-preview"
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog"
import { useWritingPreviewCache, type CachedWritingPreview } from "@/hooks/useWritingPreviewCache"
import type { CollectionOption } from "@/lib/collections/collections"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"
import { getWritingStatusLabel, type WritingStatus, WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { TablePropertySelector } from "@/components/ui/table-property-selector"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { useUserSettingsContext } from "@/components/settings/user-settings-provider"
import { createSharingService } from "@/lib/services/sharing-service-factory"
import { cn } from "@/lib/utils"

export type PreviewExportFormat = "pdf" | "docx"

export type PreviewShareResult = {
  ok: boolean
  message: string
}

type ShareLinkState = {
  active: boolean
  token: string | null
  link: string | null
  createdAt: string | null
}

type WritingPreviewModalProps = {
  open: boolean
  rows: DeskActivityRow[]
  currentIndex: number | null
  collectionOptions: CollectionOption[]
  collectionIdsByWritingId: Record<string, string[]>
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
  onToggleCollection: (writingId: string, collectionId: string) => Promise<void>
  onCreateCollection: (writingId: string, name: string) => Promise<void>
  onStatusChange?: (writingId: string, status: WritingStatus) => Promise<void>
  onArtifactTypeChange?: (writingId: string, artifactType: ArtifactType) => Promise<void>
  workspaceOptions?: WorkspaceAssignmentOption[]
  workspaceAvailable?: boolean
  onAssignWorkspace?: (writingId: string, slug: string) => void | Promise<void>
  onUnassignWorkspace?: (writingId: string) => void | Promise<void>
  onCreateWorkspace?: (writingId: string) => void | Promise<void>
  onTitleChange?: (writingId: string, title: string) => Promise<void>
  onOpenFullWriting?: (writingId: string) => void
  onExportMarkdown?: (writingId: string) => Promise<void> | void
  onExportDocument?: (writingId: string, format: PreviewExportFormat) => Promise<void>
  onShare?: (writingId: string) => Promise<PreviewShareResult>
  onOpenWebAction?: (writingId: string, action: "publish" | "share") => Promise<void>
  onDelete?: (writingId: string) => Promise<void>
}

const PREFETCH_OFFSETS = [1, -1, 2, -2]

const DEFAULT_SHARE_LINK_STATE: ShareLinkState = {
  active: false,
  token: null,
  link: null,
  createdAt: null,
}

const formatMetadataDate = (value: string | null | undefined) => {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "—"
  }

  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date)
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
}

const copyTextWithFallback = async (value: string) => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall through to the selection-based copy path for embedded browsers.
    }
  }

  if (typeof document === "undefined") {
    return false
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

function PreviewLinkSection({
  hasRemoteWriting,
  isLoadingShareLink,
  isSavingShareLink,
  shareLink,
  shareError,
  remoteFeatureMessage,
  onGenerate,
  onCopy,
  onRevoke,
}: {
  hasRemoteWriting: boolean
  isLoadingShareLink: boolean
  isSavingShareLink: boolean
  shareLink: ShareLinkState
  shareError: string | null
  remoteFeatureMessage: string
  onGenerate: () => void
  onCopy: () => void
  onRevoke: () => void
}) {
  return (
    <div className="border-t-[0.5px] border-border px-3 py-[11px]">
      <div className="mb-2">
        <p className="text-[12px] font-medium text-ink-2">Preview link</p>
        <p className="mt-0.5 text-[11px] leading-[1.45] text-ink-4">
          Share with anyone — no Artifact Studio account needed.
        </p>
      </div>

      {!hasRemoteWriting ? (
        <p className="mb-2 rounded-[6px] border-[0.5px] border-dashed border-[hsl(22_28%_78%)] bg-[hsl(22_40%_97%)] px-[10px] py-2 text-[11px] leading-[1.45] text-ink-4">
          {remoteFeatureMessage}
        </p>
      ) : null}

      {!shareLink.active || !shareLink.link ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={!hasRemoteWriting || isLoadingShareLink || isSavingShareLink}
          className="flex h-8 w-full items-center justify-center rounded-[6px] border-[0.5px] border-ink bg-ink px-[10px] text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Generate link
        </button>
      ) : (
        <>
          <div className="mb-2 break-all rounded-[6px] border-[0.5px] border-dashed border-[hsl(22_28%_78%)] bg-[hsl(22_40%_97%)] px-[10px] py-2 text-[11px] text-ink-3">
            {shareLink.link}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
            <button
              type="button"
              onClick={onCopy}
              disabled={isSavingShareLink}
              className="inline-flex h-7 min-w-0 items-center justify-center gap-[5px] rounded-[6px] border-[0.5px] border-border bg-bg px-[10px] text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Clipboard className="h-[11px] w-[11px]" strokeWidth={1.5} />
              Copy
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={isSavingShareLink}
              className="inline-flex h-7 min-w-0 items-center justify-center gap-[5px] rounded-[6px] border-[0.5px] border-border bg-bg px-[10px] text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-[11px] w-[11px]" strokeWidth={1.5} />
              Regenerate
            </button>
            <button
              type="button"
              onClick={onRevoke}
              disabled={isSavingShareLink}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border-[0.5px] border-transparent text-ink-4 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Revoke preview link"
              title="Revoke preview link"
            >
              <X className="h-[11px] w-[11px]" strokeWidth={1.5} />
            </button>
          </div>
        </>
      )}

      {isLoadingShareLink ? <p className="mt-2 text-[11px] text-ink-4">Loading preview link…</p> : null}
      {shareError ? <p className="mt-2 text-[11px] text-[hsl(0,72%,45%)]">{shareError}</p> : null}
    </div>
  )
}

export function WritingPreviewModal({
  open,
  rows,
  currentIndex,
  collectionOptions,
  collectionIdsByWritingId,
  onOpenChange,
  onIndexChange,
  onToggleCollection,
  onCreateCollection,
  onStatusChange,
  onArtifactTypeChange,
  workspaceOptions = [],
  workspaceAvailable = false,
  onAssignWorkspace,
  onUnassignWorkspace,
  onCreateWorkspace,
  onTitleChange,
  onOpenFullWriting,
  onExportMarkdown,
  onExportDocument,
  onOpenWebAction,
  onDelete,
}: WritingPreviewModalProps) {
  const { fetchPreview, getCachedPreview, prefetchPreview, retainOnly, clear, updatePreviewTitle } = useWritingPreviewCache()
  const [preview, setPreview] = useState<CachedWritingPreview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [exportOpen, setExportOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{ tone: "ok" | "error"; message: string } | null>(null)
  const [shareLink, setShareLink] = useState<ShareLinkState>(DEFAULT_SHARE_LINK_STATE)
  const [isLoadingShareLink, setIsLoadingShareLink] = useState(false)
  const [isSavingShareLink, setIsSavingShareLink] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [exportingFormat, setExportingFormat] = useState<"markdown" | PreviewExportFormat | null>(null)
  const loadIdRef = useRef(0)
  const titleDraftRef = useRef("")
  const { settings } = useUserSettingsContext()
  const sharingService = useMemo(() => createSharingService(), [])
  const enabledStatuses = WRITING_STATUS_VALUES.filter((s) => !settings.disabledStatuses.includes(s))
  const titleEditingRef = useRef(false)
  const titleWritingIdRef = useRef<string | null>(null)

  const row = currentIndex === null ? null : rows[currentIndex] ?? null
  const canGoPrevious = currentIndex !== null && currentIndex > 0
  const canGoNext = currentIndex !== null && currentIndex < rows.length - 1
  const hasRemoteWriting = preview?.lifecycle === "server-confirmed"
  const annotations = useMemo(() => preview?.annotations ?? [], [preview])
  const remoteFeatureMessage =
    preview?.lifecycle === "syncing"
      ? "Sharing, PDF, and Word unlock once sync finishes."
      : "Sharing, PDF, and Word become available after the first sync."

  const selectedCollectionIds = useMemo(
    () => (row ? collectionIdsByWritingId[row.id] ?? [] : []),
    [collectionIdsByWritingId, row],
  )
  const selectedCollections = useMemo(() => {
    const collectionOptionById = new Map(collectionOptions.map((option) => [option.id, option]))
    return selectedCollectionIds
      .map((collectionId) => collectionOptionById.get(collectionId))
      .filter((collection): collection is CollectionOption => Boolean(collection))
  }, [collectionOptions, selectedCollectionIds])

  const navigateBy = useCallback(
    (delta: number) => {
      if (currentIndex === null) {
        return
      }

      const nextIndex = currentIndex + delta
      if (nextIndex < 0 || nextIndex >= rows.length) {
        return
      }

      onIndexChange(nextIndex)
    },
    [currentIndex, onIndexChange, rows.length],
  )

  const commitTitle = useCallback(async () => {
    if (!row || !onTitleChange) {
      return
    }

    const nextTitle = titleDraft.trim() || "Untitled writing"
    const currentTitle = preview?.title ?? row.title
    if (nextTitle === currentTitle) {
      setTitleDraft(currentTitle)
      titleDraftRef.current = currentTitle
      return
    }

    await onTitleChange(row.id, nextTitle)
    updatePreviewTitle(row.id, nextTitle)
    setPreview((current) => (current && current.id === row.id ? { ...current, title: nextTitle } : current))
    setTitleDraft(nextTitle)
    titleDraftRef.current = nextTitle
  }, [onTitleChange, preview?.title, row, titleDraft, updatePreviewTitle])

  const handleOpenFullWriting = useCallback(() => {
    if (!row) {
      return
    }
    onOpenFullWriting?.(row.id)
  }, [onOpenFullWriting, row])

  const handleExportMarkdown = useCallback(async () => {
    if (!row || !onExportMarkdown) {
      return
    }
    setExportOpen(false)
    setActionFeedback(null)
    setExportingFormat("markdown")
    try {
      await onExportMarkdown(row.id)
      setActionFeedback({ tone: "ok", message: "Markdown exported." })
    } catch (error) {
      setActionFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to export Markdown.",
      })
    } finally {
      setExportingFormat(null)
    }
  }, [onExportMarkdown, row])

  const handleExportDocument = useCallback(
    async (format: PreviewExportFormat) => {
      if (!row || !onExportDocument) {
        return
      }
      setExportOpen(false)
      setActionFeedback(null)
      setExportingFormat(format)
      try {
        await onExportDocument(row.id, format)
        setActionFeedback({ tone: "ok", message: `${format.toUpperCase()} exported.` })
      } catch (error) {
        setActionFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : `Failed to export ${format.toUpperCase()}.`,
        })
      } finally {
        setExportingFormat(null)
      }
    },
    [onExportDocument, row],
  )

  const loadShareLink = useCallback(async () => {
    if (!row || !hasRemoteWriting) {
      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareError(null)
      return
    }

    setIsLoadingShareLink(true)
    setShareError(null)

    try {
      const result = await sharingService.getPreviewLink(row.id)
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Failed to load preview link.")
      }

      setShareLink(result.data)
    } catch (error) {
      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareError(error instanceof Error ? error.message : "Failed to load preview link.")
    } finally {
      setIsLoadingShareLink(false)
    }
  }, [hasRemoteWriting, row, sharingService])

  const handleGenerateShareLink = useCallback(async () => {
    if (!row || !hasRemoteWriting) {
      return
    }

    setActionFeedback(null)
    setShareError(null)
    setIsSavingShareLink(true)

    try {
      const result = await sharingService.rotatePreviewLink(row.id)
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Failed to generate preview link.")
      }

      setShareLink(result.data)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to generate preview link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [hasRemoteWriting, row, sharingService])

  const handleRevokeShareLink = useCallback(async () => {
    if (!row || !hasRemoteWriting) {
      return
    }

    setActionFeedback(null)
    setShareError(null)
    setIsSavingShareLink(true)

    try {
      const result = await sharingService.revokePreviewLink(row.id)
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Failed to revoke preview link.")
      }

      setShareLink(DEFAULT_SHARE_LINK_STATE)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to revoke preview link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [hasRemoteWriting, row, sharingService])

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLink.link) {
      return
    }

    const copied = await copyTextWithFallback(shareLink.link)

    if (copied) {
      setActionFeedback({ tone: "ok", message: "Preview link copied." })
      setShareError(null)
      return
    }

    if (typeof window !== "undefined") {
      window.prompt("Copy preview link:", shareLink.link)
      setActionFeedback({ tone: "ok", message: "Preview link ready to copy." })
      setShareError(null)
      return
    }

    setShareError("Failed to copy preview link.")
  }, [shareLink.link])

  const handleOpenWebAction = useCallback(async (action: "publish" | "share") => {
    if (!row || !onOpenWebAction) return
    setActionFeedback(null)
    try {
      await onOpenWebAction(row.id, action)
    } catch (error) {
      setActionFeedback({ tone: "error", message: error instanceof Error ? error.message : "Could not open the web action." })
    }
  }, [onOpenWebAction, row])

  const handleConfirmDelete = useCallback(async () => {
    if (!row || !onDelete) {
      return
    }
    await onDelete(row.id)
    onOpenChange(false)
  }, [onDelete, onOpenChange, row])

  useEffect(() => {
    if (!open || !row || currentIndex === null) {
      return
    }

    let cancelled = false
    const loadId = loadIdRef.current + 1
    loadIdRef.current = loadId
    const isNewWriting = titleWritingIdRef.current !== row.id
    if (isNewWriting) {
      titleWritingIdRef.current = row.id
      titleEditingRef.current = false
      setActionFeedback(null)
      setShareError(null)
      setShareLink(DEFAULT_SHARE_LINK_STATE)
    }

    const cachedPreview = getCachedPreview(row.id)
    if (cachedPreview) {
      setPreview(cachedPreview)
      if (isNewWriting || !titleEditingRef.current) {
        setTitleDraft(cachedPreview.title)
        titleDraftRef.current = cachedPreview.title
      }
      setIsLoading(false)
    } else {
      if (isNewWriting || !titleEditingRef.current) {
        setTitleDraft(row.title)
        titleDraftRef.current = row.title
      }
      setIsLoading(true)
    }

    void fetchPreview(row.id).then((nextPreview) => {
      if (cancelled || loadIdRef.current !== loadId) {
        return
      }

      setPreview(nextPreview)
      if (!titleEditingRef.current) {
        const nextTitle = nextPreview?.title ?? row.title
        setTitleDraft(nextTitle)
        titleDraftRef.current = nextTitle
      }
      setIsLoading(false)
    })

    void loadShareLink()

    const windowIds = [row.id]
    for (const offset of PREFETCH_OFFSETS) {
      const nextRow = rows[currentIndex + offset]
      if (!nextRow) {
        continue
      }

      windowIds.push(nextRow.id)
      prefetchPreview(nextRow.id)
    }
    retainOnly(windowIds)

    return () => {
      cancelled = true
    }
  }, [currentIndex, fetchPreview, getCachedPreview, loadShareLink, open, prefetchPreview, retainOnly, row, rows])

  useEffect(() => {
    if (open) {
      return
    }

    setPreview(null)
    setIsLoading(false)
    setActionFeedback(null)
    setExportOpen(false)
    setMoreOpen(false)
    setDeleteOpen(false)
    setShareLink(DEFAULT_SHARE_LINK_STATE)
    setShareError(null)
    setIsLoadingShareLink(false)
    setIsSavingShareLink(false)
    clear()
  }, [clear, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't hijack arrow keys while editing the title or interacting with inputs.
      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        navigateBy(-1)
      }

      if (event.key === "ArrowRight") {
        event.preventDefault()
        navigateBy(1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [navigateBy, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        overlayClassName="bg-[rgba(255,255,255,0.62)] backdrop-blur-[18px] backdrop-saturate-[1.15]"
        className="max-h-[88vh] max-w-[1040px] overflow-hidden rounded-[16px] border border-[rgba(255,255,255,0.72)] bg-[rgba(255,255,255,0.86)] p-0 shadow-[0_24px_80px_rgba(0,0,0,0.16),0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur-[24px]"
      >
        <DialogTitle className="sr-only">{preview?.title ?? row?.title ?? "Writing preview"}</DialogTitle>
        <DialogDescription className="sr-only">Read-only writing preview from Desk.</DialogDescription>

        <div className="flex h-[min(760px,88vh)] min-h-0 flex-col bg-bg/95">
          <div className="flex h-[50px] shrink-0 items-center justify-between gap-3 border-b-[0.5px] border-border bg-sb/85 px-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => navigateBy(-1)}
                disabled={!canGoPrevious}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                aria-label="Previous writing"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => navigateBy(1)}
                disabled={!canGoNext}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                aria-label="Next writing"
              >
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
              {currentIndex !== null ? (
                <span className="pl-1.5 text-[12px] font-medium text-ink-3">
                  {currentIndex + 1} of {rows.length}
                </span>
              ) : null}
              <span className="pl-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-4">Preview</span>
            </div>

            <div className="flex items-center gap-1">
              {onOpenFullWriting ? (
                <button
                  type="button"
                  onClick={handleOpenFullWriting}
                  className="inline-flex h-8 items-center gap-[6px] rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                >
                  <ExternalLink className="h-[13px] w-[13px]" strokeWidth={1.5} />
                  Open full writing
                </button>
              ) : null}

              {onDelete ? (
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                      aria-label="More options"
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[200px] p-[5px]">
                    <PreviewMenuItem
                        icon={<Trash2 className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                        label="Delete writing"
                        destructive
                        onSelect={() => {
                          setMoreOpen(false)
                          setDeleteOpen(true)
                        }}
                    />
                  </PopoverContent>
                </Popover>
              ) : null}

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {actionFeedback ? (
            <div
              className={cn(
                "shrink-0 border-b-[0.5px] border-border px-4 py-1.5 text-[11px]",
                actionFeedback.tone === "ok" ? "bg-sb/70 text-ink-3" : "bg-[hsl(0_60%_97%)] text-[hsl(0_72%_42%)]",
              )}
            >
              {actionFeedback.message}
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_272px]">
            <main className="min-h-0 overflow-y-auto bg-bg">
              <div className="border-b-[0.5px] border-border bg-[color-mix(in_srgb,hsl(var(--sb))_84%,hsl(var(--bg)))] px-8 py-7">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-4">Title</p>
                <input
                  value={titleDraft}
                  onFocus={() => {
                    titleEditingRef.current = true
                  }}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setTitleDraft(nextValue)
                    titleDraftRef.current = nextValue
                    titleEditingRef.current = true
                  }}
                  onBlur={() => {
                    titleEditingRef.current = false
                    void commitTitle()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                  }}
                  className="w-full bg-transparent text-[22px] font-medium leading-[1.25] text-ink outline-none placeholder:text-ink-4 focus-visible:ring-0"
                  placeholder="Untitled writing"
                  aria-label="Writing title"
                />
              </div>

              {isLoading && !preview ? (
                <div className="space-y-3 p-8">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                </div>
              ) : preview ? (
                <WritingContentFrame
                  title={preview.title}
                  bodyHtml={preview.bodyHtml}
                  bodyId="desk-preview-body"
                  bodyTestId="desk-preview-body"
                  showTitle={false}
                />
              ) : (
                <div className="p-8">
                  <p className="font-lora text-[15px] italic text-ink-3">This writing is unavailable.</p>
                </div>
              )}
            </main>

            <aside className="flex min-h-0 flex-col border-l-[0.5px] border-border bg-sb/90">
              <div className="flex h-[50px] shrink-0 items-center border-b-[0.5px] border-border px-5">
                <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-4">Properties</p>
              </div>

              <div className="space-y-5 overflow-y-auto px-4 py-5">
                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</p>
                  {row ? (
                    <TablePropertySelector
                      ariaLabel={`Change status for ${row.title}`}
                      icon={<WritingStatusIcon status={row.stateTone} />}
                      label={row.stateLabel}
                      variant="rail"
                      contentClassName="w-[248px]"
                    >
                        {enabledStatuses.map((status) => (
                          <PreviewMenuItem
                            key={status}
                            icon={<WritingStatusIcon status={status} />}
                            label={getWritingStatusLabel(status)}
                            onSelect={() => {
                              void onStatusChange?.(row.id, status)
                            }}
                          />
                        ))}
                    </TablePropertySelector>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Artifact Type</p>
                  {row ? (
                    <TablePropertySelector ariaLabel={`Change artifact type for ${row.title}`} icon={<PreviewArtifactTypeIcon artifactType={row.artifactType ?? "general"} />} label={getArtifactTypeLabel(row.artifactType ?? "general")} variant="rail" contentClassName="w-[248px]">
                      {ARTIFACT_TYPE_VALUES.map((artifactType) => <PreviewMenuItem key={artifactType} icon={<PreviewArtifactTypeIcon artifactType={artifactType} />} label={getArtifactTypeLabel(artifactType)} onSelect={() => void onArtifactTypeChange?.(row.id, artifactType)} />)}
                    </TablePropertySelector>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Workspace</p>
                  {row ? (
                    <WorkspaceAssignmentDropdown
                      writingId={row.id}
                      title={row.title}
                      currentSlug={row.workspaceSlug}
                      currentName={row.workspaceName}
                      options={workspaceOptions}
                      available={workspaceAvailable}
                      variant="rail"
                      onAssign={(writingId, slug) => onAssignWorkspace?.(writingId, slug)}
                      onUnassign={(writingId) => onUnassignWorkspace?.(writingId)}
                      onCreateWorkspace={(writingId) => onCreateWorkspace?.(writingId)}
                    />
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Collections</p>
                  {row ? (
                    <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
                      <div className="px-3 py-[9px]">
                        <CollectionAssignmentMenu
                          collections={collectionOptions}
                          selectedIds={selectedCollectionIds}
                          align="start"
                          onToggleCollection={(collectionId) => onToggleCollection(row.id, collectionId)}
                          onCreateCollection={(name) => onCreateCollection(row.id, name)}
                          title="Add to collections"
                          description="Choose labels for this writing."
                          trigger={
                            <button
                              type="button"
                              className="flex h-8 w-full items-center gap-2 rounded-[8px] text-left text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                            >
                              <Tag className="h-[13px] w-[13px] text-ink-3" strokeWidth={1.5} />
                              Add to collections
                            </button>
                          }
                        />
                      </div>

                      <div className="border-t-[0.5px] border-border px-3 py-[9px]">
                        {selectedCollections.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedCollections.map((collection) => (
                              <span
                                key={collection.id}
                                className="inline-flex min-h-[24px] items-center rounded-[9px] border-[0.5px] border-[hsl(30_16%_78%)] bg-[hsl(34_30%_92%)] px-[9px] text-[11px] font-medium tracking-[0.01em] text-[hsl(28_22%_22%)]"
                              >
                                {collection.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[12px] text-ink-4">No collections assigned yet.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Sharing</p>
                  <div className="space-y-3 rounded-[8px] border-[0.5px] border-border bg-bg px-3 py-[11px]">
                    <div><p className="text-[12px] font-medium text-ink-2">Web publishing</p><p className="mt-0.5 text-[11px] leading-[1.45] text-ink-4">Publishing and link sharing continue on web.</p></div>
                    <button type="button" onClick={() => void handleOpenWebAction("publish")} disabled={!onOpenWebAction} className="inline-flex h-8 w-full items-center justify-center gap-[6px] rounded-[6px] border-[0.5px] border-ink bg-ink px-[10px] text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><ExternalLink className="h-[11px] w-[11px]" strokeWidth={1.5} />Publish on web</button>
                    <PreviewLinkSection
                      hasRemoteWriting={hasRemoteWriting}
                      isLoadingShareLink={isLoadingShareLink}
                      isSavingShareLink={isSavingShareLink}
                      shareLink={shareLink}
                      shareError={shareError}
                      remoteFeatureMessage={remoteFeatureMessage}
                      onGenerate={() => void handleGenerateShareLink()}
                      onCopy={() => void handleCopyShareLink()}
                      onRevoke={() => void handleRevokeShareLink()}
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Export</p>
                  <Popover open={exportOpen} onOpenChange={setExportOpen}><PopoverTrigger asChild><div><PropertiesDropdownTrigger open={exportOpen} icon={<Download className="h-[13px] w-[13px]" strokeWidth={1.5} />} label="Export as…" /></div></PopoverTrigger><PopoverContent align="start" className="w-[224px] p-[5px]">
                    {onExportMarkdown ? <PreviewMenuItem icon={<FileText className="h-[13px] w-[13px]" strokeWidth={1.5} />} label={exportingFormat === "markdown" ? "Exporting Markdown…" : "Markdown (.md)"} disabled={exportingFormat !== null} onSelect={() => void handleExportMarkdown()} /> : null}
                    {onExportDocument ? <><PreviewMenuItem icon={<FileText className="h-[13px] w-[13px]" strokeWidth={1.5} />} label={exportingFormat === "pdf" ? "Exporting PDF…" : "PDF (.pdf)"} disabled={!hasRemoteWriting || exportingFormat !== null} onSelect={() => void handleExportDocument("pdf")} /><PreviewMenuItem icon={<FileType className="h-[13px] w-[13px]" strokeWidth={1.5} />} label={exportingFormat === "docx" ? "Exporting Word…" : "Word (.docx)"} disabled={!hasRemoteWriting || exportingFormat !== null} onSelect={() => void handleExportDocument("docx")} /></> : null}
                  </PopoverContent></Popover>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Metadata</p>
                  <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
                    <MetadataRow label="Created" value={formatMetadataDate(preview?.createdAt)} />
                    <MetadataRow label="Last worked" value={formatMetadataDate(preview?.contentUpdatedAt)} />
                    <MetadataRow
                      label="Word count"
                      value={preview ? preview.wordCount.toLocaleString() : "—"}
                    />
                    <MetadataRow
                      label="Annotations"
                      value={preview ? annotations.length.toLocaleString() : "—"}
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Annotations</p>
                  <AnnotationsPreview annotations={annotations} onSeeAll={handleOpenFullWriting} />
                </section>
              </div>
            </aside>
          </div>
        </div>
      </DialogContent>

      <DeleteWritingDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={preview?.title ?? row?.title}
        onConfirm={() => {
          void handleConfirmDelete()
        }}
      />
    </Dialog>
  )
}

function PreviewMenuItem({
  icon,
  label,
  onSelect,
  disabled = false,
  destructive = false,
}: {
  icon: React.ReactNode
  label: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[12px] text-ink-2 transition-colors hover:bg-muted",
        destructive && "text-[hsl(0_72%_42%)] hover:bg-[hsl(0_60%_97%)]",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className={cn("flex shrink-0 items-center text-ink-4", destructive && "text-[hsl(0_72%_42%)]")}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b-[0.5px] border-border px-3 py-[7px] last:border-b-0">
      <span className="text-[12px] text-ink-4">{label}</span>
      <span className="text-[12px] font-medium text-ink-2">{value}</span>
    </div>
  )
}

function PropertiesDropdownTrigger({
  open,
  icon,
  label,
}: {
  open: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-10 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted",
        open && "border-ink-3 bg-sb",
      )}
    >
      <span className="flex shrink-0 items-center text-ink-3">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <ChevronDown
        className={cn("h-3 w-3 shrink-0 text-ink-4 transition-transform", open && "rotate-180")}
        strokeWidth={1.5}
      />
    </button>
  )
}

function PreviewArtifactTypeIcon({ artifactType }: { artifactType: ArtifactType }) {
  const Icon = { agent: Bot, skill: Wrench, prompt: MessageSquareText, template: LayoutTemplate, status: FileText, general: Circle }[artifactType]
  return <Icon className="h-[13px] w-[13px] shrink-0 text-ink-3" strokeWidth={1.5} />
}
