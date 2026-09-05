"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FileType,
  MoreHorizontal,
  Tag,
  Trash2,
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
import { getWritingStatusLabel, type WritingStatus } from "@/lib/writings/status"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { DocumentStateIcon } from "@/components/ui/document-state-icon"
import { DocumentStateTooltipProvider } from "@/components/ui/document-state-badge"
import { TablePropertySelector } from "@/components/ui/table-property-selector"
import { getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { ArtifactTypeGlyph } from "@/components/desk/artifact-type-icon"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getVocabularyColor, listVisibleVocabulary } from "@/lib/vocabulary/resolve"
import { VocabularyChip } from "@/components/ui/vocabulary-chip"
import { createSharingService } from "@/lib/services/sharing-service-factory"
import {
  DEFAULT_PREVIEW_LINK_STATE,
  PreviewLinkSection,
} from "@/components/sharing/preview-link-section"
import type { PreviewLinkState } from "@/lib/services/contracts/sharing-service"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"

export type PreviewExportFormat = "pdf" | "docx"

export type PreviewShareResult = {
  ok: boolean
  message: string
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

/** Chrome-row button, read from the prototype: 32px, radius 7, no border. */
const CHROME_BUTTON =
  "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"



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

/**
 * Whether the key belongs to the control the user is standing on rather than to
 * the overlay.
 *
 * The overlay's shortcuts are window-level, so without this every button inside
 * it loses `Enter`: the handler would run `preventDefault()` — killing the
 * button's own activation — and navigate away instead. Requirement 6 means
 * "`⏎` opens the artifact **when the focus is on the overlay**", not "`⏎` is
 * hijacked everywhere inside it".
 */
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], [role='button'], [role='menuitem'], [role='menuitemcheckbox'], [contenteditable='true']"

const isInteractiveTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return Boolean(target.closest(INTERACTIVE_SELECTOR))
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
  const [shareLink, setShareLink] = useState<PreviewLinkState>(DEFAULT_PREVIEW_LINK_STATE)
  const [isLoadingShareLink, setIsLoadingShareLink] = useState(false)
  const [isSavingShareLink, setIsSavingShareLink] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [exportingFormat, setExportingFormat] = useState<"markdown" | PreviewExportFormat | null>(null)
  const loadIdRef = useRef(0)
  const titleDraftRef = useRef("")
  const catalog = useVocabulary()
  const sharingService = useMemo(() => createSharingService(), [])
  const enabledStatuses = listVisibleVocabulary(catalog, "status").map((item) => item.key) as WritingStatus[]
  const enabledArtifactTypes = listVisibleVocabulary(catalog, "type").map((item) => item.key) as ArtifactType[]
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

    const nextTitle = titleDraft.trim() || "Untitled artifact"
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
      setShareLink(DEFAULT_PREVIEW_LINK_STATE)
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
      setShareLink(DEFAULT_PREVIEW_LINK_STATE)
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

      setShareLink(DEFAULT_PREVIEW_LINK_STATE)
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
      setShareLink(DEFAULT_PREVIEW_LINK_STATE)
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
    setShareLink(DEFAULT_PREVIEW_LINK_STATE)
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

      // A key already consumed by a dropdown, a popover or the dialog itself is
      // not the overlay's to act on a second time.
      if (event.defaultPrevented) {
        return
      }

      // Standing on a control means the key belongs to that control. Without
      // this, Enter on "Generate link" would navigate to the full artifact and
      // suppress the button's own activation, and the arrows would move to
      // another artifact from under an open menu.
      if (isInteractiveTarget(event.target)) {
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

      if (event.key === "Enter") {
        event.preventDefault()
        handleOpenFullWriting()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleOpenFullWriting, navigateBy, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        data-testid="preview-overlay"
        overlayClassName="bg-[rgba(35,24,15,0.22)] backdrop-blur-[14px] backdrop-saturate-[1.15]"
        className="h-[min(840px,100%)] max-h-[calc(100vh-56px)] w-[min(1160px,100%)] max-w-[calc(100vw-56px)] overflow-hidden rounded-bar border-0 bg-bg p-0 px-2 pb-2 shadow-modal"
      >
        <DialogTitle className="sr-only">{preview?.title ?? row?.title ?? "Artifact preview"}</DialogTitle>
        <DialogDescription className="sr-only">Read-only artifact preview from Desk.</DialogDescription>

        <DocumentStateTooltipProvider>
        <div className="flex h-full min-h-0 flex-col">
          {/* Layer 0 — the chrome row. */}
          <div
            data-testid="preview-chrome"
            className="flex h-12 flex-shrink-0 items-center gap-2.5 pl-2 pr-1.5"
          >
              <button
                type="button"
                onClick={() => navigateBy(-1)}
                disabled={!canGoPrevious}
                className={CHROME_BUTTON}
                aria-label="Previous artifact"
              >
                <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => navigateBy(1)}
                disabled={!canGoNext}
                className={CHROME_BUTTON}
                aria-label="Next artifact"
              >
                <ArrowRight className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </button>
              {currentIndex !== null ? (
                <span data-testid="preview-counter" className="whitespace-nowrap text-[13px] text-ink-2">
                  {currentIndex + 1} of {rows.length}
                </span>
              ) : null}
              <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-4">Preview</span>

              <span className="flex-1" />

              {onOpenFullWriting ? (
                <button
                  type="button"
                  onClick={handleOpenFullWriting}
                  className="inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-[8px] border-[0.5px] border-border bg-sb px-[13px] text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-6 hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                >
                  <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.5} />
                  Open full artifact
                </button>
              ) : null}

              {onDelete ? (
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className={CHROME_BUTTON} aria-label="More options">
                      <MoreHorizontal className="h-[17px] w-[17px]" strokeWidth={1.5} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[200px] p-[5px]">
                    <PreviewMenuItem
                        icon={<Trash2 className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                        label="Delete artifact"
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
                className={CHROME_BUTTON}
                aria-label="Close preview"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </button>
          </div>

          {actionFeedback ? (
            <div
              role="status"
              className={cn(
                "mx-0 mb-2 flex-shrink-0 rounded-[8px] px-3 py-1.5 text-[12px]",
                actionFeedback.tone === "ok" ? "bg-sb text-ink-3" : "bg-[hsl(0_60%_97%)] text-destructive",
              )}
            >
              {actionFeedback.message}
            </div>
          ) : null}

          {/* Layer 1 — the two sheets. */}
          <div className="flex min-h-0 flex-1 gap-2">
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-sb shadow-float">
              <div
                data-testid="preview-sheet-header"
                className="flex-shrink-0 border-b-[0.5px] border-line-soft px-10 pb-[22px] pt-[26px]"
              >
                <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-4">Title</p>
                {/*
                  The prototype draws a static Lora 500/28 heading. It stays an
                  input so renaming from the preview survives the redesign — the
                  painted type is the prototype's, the capability is the repo's.
                */}
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
                  data-testid="preview-title"
                  className="odessay-writing-title w-full bg-transparent text-[28px] font-medium leading-[1.25] tracking-[-0.015em] text-ink outline-none placeholder:text-ink-4 focus-visible:ring-0"
                  placeholder="Untitled artifact"
                  aria-label="Artifact title"
                />
                <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                  {row ? <DocumentStateIcon state={row.documentState} className="h-[22px] w-[22px]" /> : null}
                  <span className="text-[12px] text-ink-5">
                    {preview ? `${preview.wordCount.toLocaleString()} words` : "—"}
                    {preview?.createdAt ? ` · ${formatMetadataDate(preview.createdAt)}` : ""}
                  </span>
                  {row?.localPath ? (
                    <span
                      title={row.localPath}
                      data-testid="preview-path"
                      className="min-w-0 flex-1 truncate font-mono text-[11px] leading-[1.4] text-ink-5"
                    >
                      {row.localPath}
                    </span>
                  ) : null}
                </div>
              </div>

              {isLoading && !preview ? (
                <div className="space-y-3 px-10 py-8">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                </div>
              ) : preview ? (
                <div className="od-scroll min-h-0 flex-1 overflow-y-auto px-10 pb-[60px] pt-[30px]">
                  <WritingContentFrame
                    title={preview.title}
                    bodyHtml={preview.bodyHtml}
                    bodyId="desk-preview-body"
                    bodyTestId="desk-preview-body"
                    showTitle={false}
                  />
                </div>
              ) : (
                /*
                 * Failure mode 2 — the artifact went away while the overlay was
                 * open. A recoverable state with a way out; never a draft.
                 */
                <div data-testid="preview-unavailable" className="px-10 py-10">
                  <p className="mb-1.5 font-lora text-[20px] font-medium text-ink">This artifact is unavailable</p>
                  <p className="mb-4 text-[14px] leading-[1.5] text-ink-4">
                    It may have been deleted or moved while the preview was open.
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="inline-flex h-[34px] items-center rounded-[8px] border-[0.5px] border-border bg-sb px-[13px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-row-hover"
                  >
                    Close preview
                  </button>
                </div>
              )}
            </main>

            <aside
              data-testid="preview-properties"
              className="od-scroll flex w-[308px] flex-shrink-0 flex-col gap-[22px] overflow-y-auto bg-transparent pb-6 pl-3.5 pr-2.5 pt-[18px]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-4">Properties</p>

              <div className="contents">
                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Status</p>
                  {row ? (
                    <TablePropertySelector
                      ariaLabel={`Change status for ${row.title}`}
                      icon={
                        <VocabularyChip color={getVocabularyColor(catalog, "status", row.stateTone)} size={20}>
                          <WritingStatusIcon status={row.stateTone} className="h-[12px] w-[12px]" />
                        </VocabularyChip>
                      }
                      label={row.stateLabel}
                      variant="preview"
                      contentClassName="w-[248px]"
                    >
                        {enabledStatuses.map((status) => (
                          <PreviewMenuItem
                            key={status}
                            icon={
                              <VocabularyChip color={getVocabularyColor(catalog, "status", status)} size={20}>
                                <WritingStatusIcon status={status} className="h-[12px] w-[12px]" />
                              </VocabularyChip>
                            }
                            label={getWritingStatusLabel(status)}
                            onSelect={() => {
                              void onStatusChange?.(row.id, status)
                            }}
                          />
                        ))}
                    </TablePropertySelector>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Artifact Type</p>
                  {row ? (
                    <TablePropertySelector
                      ariaLabel={`Change artifact type for ${row.title}`}
                      icon={
                        <VocabularyChip color={getVocabularyColor(catalog, "type", row.artifactType ?? "general")} size={20}>
                          <ArtifactTypeGlyph artifactType={row.artifactType ?? "general"} className="h-[12px] w-[12px] shrink-0" />
                        </VocabularyChip>
                      }
                      label={getArtifactTypeLabel(row.artifactType ?? "general")}
                      variant="preview"
                      contentClassName="w-[248px]"
                    >
                      {enabledArtifactTypes.map((artifactType) => (
                        <PreviewMenuItem
                          key={artifactType}
                          icon={
                            <VocabularyChip color={getVocabularyColor(catalog, "type", artifactType)} size={20}>
                              <ArtifactTypeGlyph artifactType={artifactType} className="h-[12px] w-[12px] shrink-0" />
                            </VocabularyChip>
                          }
                          label={getArtifactTypeLabel(artifactType)}
                          onSelect={() => void onArtifactTypeChange?.(row.id, artifactType)}
                        />
                      ))}
                    </TablePropertySelector>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Workspace</p>
                  {row ? (
                    <WorkspaceAssignmentDropdown
                      writingId={row.id}
                      title={row.title}
                      currentSlug={row.workspaceSlug}
                      currentName={row.workspaceName}
                      options={workspaceOptions}
                      available={workspaceAvailable}
                      variant="desk"
                      onAssign={(writingId, slug) => onAssignWorkspace?.(writingId, slug)}
                      onUnassign={(writingId) => onUnassignWorkspace?.(writingId)}
                      onCreateWorkspace={(writingId) => onCreateWorkspace?.(writingId)}
                    />
                  ) : null}
                </section>

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Collections</p>
                  {row ? (
                    <div className="flex flex-col gap-2 rounded-[10px] border-[0.5px] border-border bg-transparent px-[13px] py-3">
                      <div>
                        <CollectionAssignmentMenu
                          collections={collectionOptions}
                          selectedIds={selectedCollectionIds}
                          align="start"
                          onToggleCollection={(collectionId) => onToggleCollection(row.id, collectionId)}
                          onCreateCollection={(name) => onCreateCollection(row.id, name)}
                          title="Add to collections"
                          description="Choose labels for this artifact."
                          trigger={
                            <button
                              type="button"
                              className="inline-flex items-center gap-[9px] text-left text-[13px] font-medium text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                            >
                              <Tag className="h-[15px] w-[15px]" strokeWidth={1.5} />
                              Add to collections
                            </button>
                          }
                        />
                      </div>

                      <div>
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
                          <p className="text-[12px] leading-[1.5] text-ink-5">No collections assigned yet.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Sharing</p>
                  {/*
                    The sharing card: bordered, radius 10, its two blocks split by
                    a 1px rule. Web publishing and the preview link are different
                    mechanisms, and the card is what keeps them from reading as one.
                  */}
                  <div
                    data-testid="preview-sharing-card"
                    className="flex flex-col gap-3.5 rounded-[10px] border-[0.5px] border-border bg-transparent px-[13px] py-3.5"
                  >
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[13px] font-medium text-ink">Web publishing</p>
                      <p className="text-pretty text-[12px] leading-[1.5] text-ink-4">
                        Publishing and link sharing continue on web.
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleOpenWebAction("publish")}
                        disabled={!onOpenWebAction}
                        className="mt-1 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] bg-ink text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ExternalLink className="h-[14px] w-[14px]" strokeWidth={1.5} />
                        Publish on web
                      </button>
                    </div>

                    <div aria-hidden data-testid="preview-sharing-rule" className="h-px w-full bg-border" />

                    <PreviewLinkSection
                      size="card"
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

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Export</p>
                  <Popover open={exportOpen} onOpenChange={setExportOpen}><PopoverTrigger asChild><div><PropertiesDropdownTrigger open={exportOpen} icon={<Download className="h-[13px] w-[13px]" strokeWidth={1.5} />} label="Export as…" /></div></PopoverTrigger><PopoverContent align="start" className="w-[224px] p-[5px]">
                    {onExportMarkdown ? <PreviewMenuItem icon={<FileText className="h-[13px] w-[13px]" strokeWidth={1.5} />} label={exportingFormat === "markdown" ? "Exporting Markdown…" : "Markdown (.md)"} disabled={exportingFormat !== null} onSelect={() => void handleExportMarkdown()} /> : null}
                    {onExportDocument ? <><PreviewMenuItem icon={<FileText className="h-[13px] w-[13px]" strokeWidth={1.5} />} label={exportingFormat === "pdf" ? "Exporting PDF…" : "PDF (.pdf)"} disabled={!hasRemoteWriting || exportingFormat !== null} onSelect={() => void handleExportDocument("pdf")} /><PreviewMenuItem icon={<FileType className="h-[13px] w-[13px]" strokeWidth={1.5} />} label={exportingFormat === "docx" ? "Exporting Word…" : "Word (.docx)"} disabled={!hasRemoteWriting || exportingFormat !== null} onSelect={() => void handleExportDocument("docx")} /></> : null}
                  </PopoverContent></Popover>
                </section>

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Metadata</p>
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

                <section className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Annotations</p>
                  <AnnotationsPreview annotations={annotations} onSeeAll={handleOpenFullWriting} />
                </section>
              </div>
            </aside>
          </div>
        </div>
        </DocumentStateTooltipProvider>
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

