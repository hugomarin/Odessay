"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FileType,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { TextMetrics } from "@/lib/editor/text-metrics"
import type { WritingLifecycle, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { buildWebWritingActionUrl, openExternalUrl, type WebWritingAction } from "@/lib/runtime/external-link"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { createSharingService } from "@/lib/services/sharing-service-factory"
import {
  DEFAULT_PREVIEW_LINK_STATE,
  PreviewLinkSection,
} from "@/components/sharing/preview-link-section"
import type { PreviewLinkState } from "@/lib/services/contracts/sharing-service"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"
import { WritingStatusPicker } from "@/components/writings/writing-status-picker"
import { ArtifactTypeSelector } from "@/components/ui/artifact-type-selector"
import { WritingStyleSelector } from "@/components/ui/writing-style-selector"
import { useVocabulary } from "@/hooks/useVocabulary"
import { listVisibleVocabulary } from "@/lib/vocabulary/resolve"
import { WritingCollectionsSection } from "./writing-collections-section"
import { WritingSharesSection } from "./writing-shares-section"
import type { ArtifactType } from "@/lib/writings/artifact-type"

type PropertiesPanelProps = {
  /**
   * Which of its two tabs to render. Sharing and Export moved behind "share"
   * (owner review), but they read the same link, share and export state this
   * component already owns — splitting them into a component of their own would
   * have meant lifting all of it into the shell for no gain.
   */
  tab: "properties" | "share"
  writingId: string | null
  lifecycle: WritingLifecycle
  status: WritingStatus
  artifactType: ArtifactType
  visibility: WritingVisibility
  metrics: TextMetrics
  /** Canonical path of the document, when the runtime has one. */
  canonicalPath?: string | null
  onStatusChange: (next: WritingStatus) => void
  onArtifactTypeChange: (next: ArtifactType) => void
  onVisibilityChange: (next: WritingVisibility) => void
  onExportMarkdown: () => Promise<boolean | void> | boolean | void
  onExportPdf: () => Promise<boolean | void> | boolean | void
  onExportDocx: () => Promise<boolean | void> | boolean | void
}

type ExportFormat = "markdown" | "pdf" | "docx"

function DropdownTrigger({
  open,
  icon,
  label,
}: {
  open: boolean
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-[8px] border-[0.5px] border-border bg-bg px-[10px] text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted",
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

type PopoverItemProps = {
  selected?: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  onSelect: () => void
}

function PopoverItem({ selected = false, disabled = false, icon, label, onSelect }: PopoverItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex h-[34px] w-full items-center gap-2 rounded-[6px] px-[10px] text-left text-[12px] text-ink-2 transition-colors hover:bg-muted",
        selected && "font-medium text-ink",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className={cn("flex shrink-0 items-center text-ink-4", selected && "text-ink-2")}>{icon}</span>
      <span>{label}</span>
      {selected ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ink" /> : null}
    </button>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b-[0.5px] border-border px-3 py-[7px] last:border-b-0">
      <span className="text-[12px] text-ink-4">{label}</span>
      <span className="text-[12px] font-medium text-ink-2">{value}</span>
    </div>
  )
}

export function PropertiesPanel({
  tab,
  writingId,
  lifecycle,
  status,
  artifactType,
  visibility,
  metrics,
  canonicalPath = null,
  onExportMarkdown,
  onExportPdf,
  onExportDocx,
  onStatusChange,
  onArtifactTypeChange,
  onVisibilityChange,
}: PropertiesPanelProps) {
  const [shareLink, setShareLink] = useState<PreviewLinkState>(DEFAULT_PREVIEW_LINK_STATE)
  const [isLoadingShareLink, setIsLoadingShareLink] = useState(false)
  const [isSavingShareLink, setIsSavingShareLink] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [externalLinkError, setExternalLinkError] = useState<string | null>(null)
  const [openingExternalAction, setOpeningExternalAction] = useState<WebWritingAction | null>(null)
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingDocx, setIsExportingDocx] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const catalog = useVocabulary()
  const sharingService = useMemo(() => createSharingService(), [])
  const enabledStatuses = useMemo(
    () => listVisibleVocabulary(catalog, "status").map((item) => item.key),
    [catalog],
  )
  const isDesktop = isTauriRuntime()

  const hasRemoteWriting = Boolean(writingId) && lifecycle === "server-confirmed"
  const remoteFeatureMessage =
    lifecycle === "syncing"
      ? "Sharing, collections, PDF, and Word unlock once sync finishes."
      : "Sharing, collections, PDF, and Word become available after the first sync."

  const loadShareLink = useCallback(async () => {
    if (!hasRemoteWriting || !writingId) {
      setShareLink(DEFAULT_PREVIEW_LINK_STATE)
      setShareError(null)
      return
    }

    setIsLoadingShareLink(true)
    setShareError(null)

    try {
      const result = await sharingService.getPreviewLink(writingId)
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
  }, [hasRemoteWriting, sharingService, writingId])

  useEffect(() => {
    void loadShareLink()
  }, [loadShareLink])

  const handleGenerateShareLink = useCallback(async () => {
    if (!hasRemoteWriting || !writingId) {
      return
    }

    setIsSavingShareLink(true)
    setShareError(null)

    try {
      const result = await sharingService.rotatePreviewLink(writingId)
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Failed to generate preview link.")
      }

      setShareLink(result.data)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to generate preview link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [hasRemoteWriting, sharingService, writingId])

  const handleRevokeShareLink = useCallback(async () => {
    if (!hasRemoteWriting || !writingId) {
      return
    }

    setIsSavingShareLink(true)
    setShareError(null)

    try {
      const result = await sharingService.revokePreviewLink(writingId)
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Failed to revoke preview link.")
      }

      setShareLink(DEFAULT_PREVIEW_LINK_STATE)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to revoke preview link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [hasRemoteWriting, sharingService, writingId])

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLink.link) {
      return
    }

    const copied = await copyTextWithFallback(shareLink.link)

    if (copied) {
      setShareError(null)
      return
    }

    if (typeof window !== "undefined") {
      window.prompt("Copy preview link:", shareLink.link)
      setShareError(null)
      return
    }

    setShareError("Failed to copy preview link.")
  }, [shareLink.link])

  const handleSharesStateChange = useCallback(
    (hasShares: boolean) => {
      if (hasShares && visibility === "private") {
        onVisibilityChange("shared")
      }
    },
    [onVisibilityChange, visibility],
  )

  const handleOpenWebAction = useCallback(
    async (action: WebWritingAction) => {
      if (!writingId) {
        setExternalLinkError("This artifact needs an id before it can open on web.")
        return
      }

      const url = buildWebWritingActionUrl({ writingId, action })
      if (!url) {
        setExternalLinkError("NEXT_PUBLIC_APP_URL is not configured for web handoff.")
        return
      }

      setOpeningExternalAction(action)
      setExternalLinkError(null)

      try {
        await openExternalUrl(url)
      } catch (error) {
        setExternalLinkError(error instanceof Error ? error.message : "Failed to open web browser.")
      } finally {
        setOpeningExternalAction(null)
      }
    },
    [writingId],
  )

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setExportOpen(false)
      setExportFeedback(null)
      setExportError(null)

      if (format === "markdown") {
        setIsExportingMarkdown(true)
      } else if (format === "pdf") {
        setIsExportingPdf(true)
      } else {
        setIsExportingDocx(true)
      }

      try {
        if (format === "markdown") {
          const exported = await onExportMarkdown()
          if (exported === false) return
          setExportFeedback("Markdown export generated.")
        } else if (format === "pdf") {
          const exported = await onExportPdf()
          if (exported === false) return
          setExportFeedback("PDF export generated.")
        } else {
          const exported = await onExportDocx()
          if (exported === false) return
          setExportFeedback("Word export generated.")
        }
      } catch (error) {
        const fallback = format === "markdown" ? "Markdown" : format === "pdf" ? "PDF" : "Word"
        setExportError(error instanceof Error ? error.message : `Failed to export ${fallback}.`)
      } finally {
        setIsExportingMarkdown(false)
        setIsExportingPdf(false)
        setIsExportingDocx(false)
      }
    },
    [onExportDocx, onExportMarkdown, onExportPdf],
  )

  return (
    <aside
      id="editor-panel-properties"
      data-section="editor-panel-properties"
      data-testid="editor-panel-properties"
      className="EditorPanelProperties od-scroll h-full w-full overflow-y-auto overflow-x-hidden bg-transparent"
    >
      <div className="space-y-5 p-4">
        {tab === "properties" ? (
          <>
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</p>
          <WritingStatusPicker
            value={status}
            onChange={onStatusChange}
            enabledStatuses={enabledStatuses}
          />
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Artifact Type</p>
          <ArtifactTypeSelector
            value={artifactType}
            onChange={onArtifactTypeChange}
          />
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Style</p>
          <WritingStyleSelector />
          <p className="text-[10px] leading-[1.4] text-ink-4">Applied to all artifacts on this device.</p>
        </section>

        {hasRemoteWriting && writingId ? <WritingCollectionsSection writingId={writingId} /> : null}


        {canonicalPath ? (
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Path</p>
            <p
              data-testid="editor-properties-path"
              title={canonicalPath}
              className="truncate rounded-[8px] border-[0.5px] border-border bg-bg px-3 py-2 font-mono text-[11px] text-ink-3"
              dir="rtl"
            >
              {canonicalPath}
            </p>
          </section>
        ) : null}

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Info</p>
          <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
            <MetricRow label="Words" value={metrics.words.toLocaleString()} />
            <MetricRow label="Characters" value={metrics.characters.toLocaleString()} />
            <MetricRow label="Sentences" value={metrics.sentences.toLocaleString()} />
            <MetricRow label="Reading time" value={`${metrics.readingTimeMinutes} min`} />
            <MetricRow label="Pages" value={metrics.pages.toFixed(1)} />
          </div>
        </section>
          </>
        ) : (
          <>
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Sharing</p>
          <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
            {isDesktop ? (
              <div className="space-y-3 px-3 py-[11px]">
                <div>
                  <p className="text-[12px] font-medium text-ink-2">Web publishing</p>
                  <p className="mt-0.5 text-[11px] leading-[1.45] text-ink-4">
                    The artifact stays saved locally. Publishing and link sharing continue on web.
                  </p>
                </div>
                {!hasRemoteWriting ? (
                  <p className="rounded-[6px] border-[0.5px] border-dashed border-[hsl(22_28%_78%)] bg-[hsl(22_40%_97%)] px-[10px] py-2 text-[11px] leading-[1.45] text-ink-4">
                    {remoteFeatureMessage}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleOpenWebAction("publish")}
                    disabled={!hasRemoteWriting || openingExternalAction !== null}
                    className="inline-flex h-8 w-full items-center justify-center gap-[6px] rounded-[6px] border-[0.5px] border-ink bg-ink px-[10px] text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ExternalLink className="h-[11px] w-[11px]" strokeWidth={1.5} />
                    {openingExternalAction === "publish" ? "Opening..." : "Publish on web"}
                  </button>
                </div>
                {externalLinkError ? (
                  <p className="text-[11px] text-[hsl(0,72%,45%)]">{externalLinkError}</p>
                ) : null}
                {hasRemoteWriting && writingId ? (
                  <div className="-mx-3 border-t-[0.5px] border-border">
                    <WritingSharesSection
                      writingId={writingId}
                      onSharesStateChange={handleSharesStateChange}
                    />
                  </div>
                ) : null}
                <div className="-mx-3 border-t-[0.5px] border-border">
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
              </div>
            ) : hasRemoteWriting && writingId ? (
              <WritingSharesSection
                writingId={writingId}
                onSharesStateChange={handleSharesStateChange}
              />
            ) : null}

            {!isDesktop ? (
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
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Export</p>
          <Popover open={exportOpen} onOpenChange={setExportOpen}>
            <PopoverTrigger asChild>
              <div>
                <DropdownTrigger
                  open={exportOpen}
                  icon={<Download className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                  label="Export as…"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[216px] p-[5px]">
              <PopoverItem
                label={isExportingMarkdown ? "Exporting Markdown..." : "Markdown (.md)"}
                icon={<FileText className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                onSelect={() => void handleExport("markdown")}
                disabled={isExportingMarkdown}
              />
              <PopoverItem
                label={isExportingPdf ? "Exporting PDF..." : "PDF (.pdf)"}
                icon={<FileText className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                onSelect={() => void handleExport("pdf")}
                disabled={!hasRemoteWriting || isExportingPdf}
              />
              <PopoverItem
                label={isExportingDocx ? "Exporting Word..." : "Word (.docx)"}
                icon={<FileType className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                onSelect={() => void handleExport("docx")}
                disabled={!hasRemoteWriting || isExportingDocx}
              />
              <div className="my-1 h-px bg-border" />
              <p className="px-[10px] pb-1 pt-1.5 text-[10px] leading-[1.4] text-ink-4">
                Markdown is local. PDF and Word require a saved artifact.
              </p>
            </PopoverContent>
          </Popover>
          {exportFeedback ? <p className="text-[11px] text-ink-3">{exportFeedback}</p> : null}
          {exportError ? <p className="text-[11px] text-[hsl(0,72%,45%)]">{exportError}</p> : null}
        </section>
          </>
        )}
      </div>
    </aside>
  )
}
