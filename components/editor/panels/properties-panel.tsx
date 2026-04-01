"use client"

import { useCallback, useEffect, useState } from "react"
import { X } from "lucide-react"
import type { WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import type { TextMetrics } from "@/lib/editor/text-metrics"
import type { EditorSpellcheckPreference } from "@/lib/editor/spellcheck"
import { cn } from "@/lib/utils"
import { WritingSharesSection } from "./writing-shares-section"

type PropertiesPanelProps = {
  writingId: string | null
  title: string
  status: WritingStatus
  visibility: WritingVisibility
  metrics: TextMetrics
  spellcheckPreference: EditorSpellcheckPreference
  spellcheckLanguage: string
  onStatusChange: (next: WritingStatus) => void
  onVisibilityChange: (next: WritingVisibility) => void
  onSpellcheckPreferenceChange: (next: EditorSpellcheckPreference) => void
  onExportMarkdown: () => Promise<void> | void
  onExportPdf: () => Promise<void> | void
  onExportDocx: () => Promise<void> | void
  onClose: () => void
}

const STATUS_OPTIONS: Array<{ value: WritingStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "finished", label: "Done" },
]

const VISIBILITY_COPY: Record<WritingVisibility, { label: string; description: string }> = {
  private: {
    label: "Private",
    description: "Only you can access this writing.",
  },
  shared: {
    label: "Shared",
    description: "Shared users can read and respond.",
  },
  public: {
    label: "Public",
    description: "Anyone with the link can view it.",
  },
}

type ShareLinkState = {
  active: boolean
  token: string | null
  link: string | null
  createdAt: string | null
}

type ApiEnvelope<TData> = {
  data: TData | null
  error: {
    code: string
    message: string
  } | null
}

const DEFAULT_SHARE_LINK_STATE: ShareLinkState = {
  active: false,
  token: null,
  link: null,
  createdAt: null,
}

const getReadableDate = (value: string | null) => {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function PropertiesPanel({
  writingId,
  title,
  status,
  visibility,
  metrics,
  spellcheckPreference,
  spellcheckLanguage,
  onExportMarkdown,
  onExportPdf,
  onExportDocx,
  onStatusChange,
  onVisibilityChange,
  onSpellcheckPreferenceChange,
  onClose,
}: PropertiesPanelProps) {
  const [shareLink, setShareLink] = useState<ShareLinkState>(DEFAULT_SHARE_LINK_STATE)
  const [isLoadingShareLink, setIsLoadingShareLink] = useState(false)
  const [isSavingShareLink, setIsSavingShareLink] = useState(false)
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingDocx, setIsExportingDocx] = useState(false)

  const shareApiPath = writingId ? `/api/writings/${writingId}/share-test-link` : null
  const shareLinkCreatedAt = getReadableDate(shareLink.createdAt)

  const loadShareLink = useCallback(async () => {
    if (!shareApiPath) {
      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareError(null)
      setShareFeedback(null)
      return
    }

    setIsLoadingShareLink(true)
    setShareError(null)

    try {
      const response = await fetch(shareApiPath, { method: "GET" })
      const payload = (await response.json()) as ApiEnvelope<ShareLinkState>

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to load test link.")
      }

      setShareLink(payload.data)
    } catch (error) {
      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareError(error instanceof Error ? error.message : "Failed to load test link.")
    } finally {
      setIsLoadingShareLink(false)
    }
  }, [shareApiPath])

  useEffect(() => {
    void loadShareLink()
  }, [loadShareLink])

  const handleGenerateShareLink = useCallback(async () => {
    if (!shareApiPath) {
      return
    }

    setIsSavingShareLink(true)
    setShareError(null)
    setShareFeedback(null)

    try {
      const response = await fetch(shareApiPath, { method: "POST" })
      const payload = (await response.json()) as ApiEnvelope<ShareLinkState & { replacedPrevious?: boolean }>

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to generate test link.")
      }

      setShareLink(payload.data)
      setShareFeedback(payload.data.replacedPrevious ? "Preview link regenerated." : "Preview link generated.")
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to generate test link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [shareApiPath])

  const handleRevokeShareLink = useCallback(async () => {
    if (!shareApiPath) {
      return
    }

    setIsSavingShareLink(true)
    setShareError(null)
    setShareFeedback(null)

    try {
      const response = await fetch(shareApiPath, { method: "DELETE" })
      const payload = (await response.json()) as ApiEnvelope<{ active: boolean; revoked: boolean }>

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to revoke test link.")
      }

      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareFeedback(payload.data.revoked ? "Preview link revoked." : "No active preview link to revoke.")
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to revoke test link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [shareApiPath])

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLink.link || typeof navigator === "undefined" || !navigator.clipboard) {
      return
    }

    try {
      await navigator.clipboard.writeText(shareLink.link)
      setShareFeedback("Preview link copied.")
      setShareError(null)
    } catch {
      setShareError("Failed to copy preview link.")
    }
  }, [shareLink.link])

  const visibilityCopy = VISIBILITY_COPY[visibility]
  const handleExportMarkdown = useCallback(async () => {
    setExportFeedback(null)
    setExportError(null)
    setIsExportingMarkdown(true)

    try {
      await onExportMarkdown()
      setExportFeedback("Markdown export generated.")
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export Markdown.")
    } finally {
      setIsExportingMarkdown(false)
    }
  }, [onExportMarkdown])

  const handleExportPdf = useCallback(async () => {
    setExportFeedback(null)
    setExportError(null)
    setIsExportingPdf(true)

    try {
      await onExportPdf()
      setExportFeedback("PDF export generated.")
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export PDF.")
    } finally {
      setIsExportingPdf(false)
    }
  }, [onExportPdf])

  const handleExportDocx = useCallback(async () => {
    setExportFeedback(null)
    setExportError(null)
    setIsExportingDocx(true)

    try {
      await onExportDocx()
      setExportFeedback("Word export generated.")
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export Word.")
    } finally {
      setIsExportingDocx(false)
    }
  }, [onExportDocx])

  const handleSharesStateChange = useCallback(
    (hasShares: boolean) => {
      if (hasShares && visibility === "private") {
        onVisibilityChange("shared")
      }
    },
    [onVisibilityChange, visibility],
  )

  return (
    <aside
      id="editor-panel-properties"
      data-section="editor-panel-properties"
      data-testid="editor-panel-properties"
      className="EditorPanelProperties fixed right-0 top-[46px] bottom-8 z-40 w-[248px] border-l-[0.5px] border-border bg-sb overflow-y-auto"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Properties</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close properties panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Status</p>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map((option) => {
              const active = status === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onStatusChange(option.value)}
                  className={cn(
                    "h-8 rounded-md border-[0.5px] text-[12px] font-medium transition-colors",
                    active
                      ? "border-ink bg-ink text-bg"
                      : "border-border bg-bg text-ink-3 hover:bg-muted hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Visibility</p>
          <div className="rounded-md border-[0.5px] border-border bg-bg px-3 py-2">
            <p className="text-[12px] font-medium text-ink">{visibilityCopy.label}</p>
            <p className="mt-1 text-[11px] text-ink-4">{visibilityCopy.description}</p>
          </div>
        </section>

        {writingId ? (
          <WritingSharesSection
            writingId={writingId}
            onSharesStateChange={handleSharesStateChange}
          />
        ) : null}

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Export</p>
          <div className="space-y-3 rounded-lg border-[0.5px] border-border bg-bg p-3">
            <p className="text-[11px] leading-relaxed text-ink-3">
              Export “{title}” as Markdown, PDF, or Word.
            </p>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => void handleExportMarkdown()}
                disabled={isExportingMarkdown}
                className={cn(
                  "h-8 rounded-md border-[0.5px] px-3 text-[11px] font-medium transition-colors",
                  "border-ink bg-ink text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {isExportingMarkdown ? "Exporting Markdown..." : "Markdown (.md)"}
              </button>

              <button
                type="button"
                onClick={() => void handleExportPdf()}
                disabled={!writingId || isExportingPdf}
                className="h-8 rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExportingPdf ? "Exporting PDF..." : "PDF (.pdf)"}
              </button>

              <button
                type="button"
                onClick={() => void handleExportDocx()}
                disabled={!writingId || isExportingDocx}
                className="h-8 rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExportingDocx ? "Exporting Word..." : "Word (.docx)"}
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-ink-4">
              Markdown is generated locally. PDF and Word exports require a saved writing.
            </p>
            {exportFeedback ? <p className="text-[11px] text-ink-3">{exportFeedback}</p> : null}
            {exportError ? <p className="text-[11px] text-[hsl(0,72%,45%)]">{exportError}</p> : null}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Closed Sharing</p>
          <div className="space-y-3 rounded-lg border-[0.5px] border-border bg-[hsl(22,55%,97%)] p-3">
            <p className="text-[11px] leading-relaxed text-ink-3">
              Generate a private read-only link for external UX testing. This does not change writing visibility.
            </p>

            {!writingId ? (
              <p className="text-[11px] text-ink-4">Save the writing once before generating a preview link.</p>
            ) : (
              <>
                {shareLink.active && shareLink.link ? (
                  <div className="space-y-2">
                    <div className="rounded-md border-[0.5px] border-border bg-bg px-2 py-1.5">
                      <p className="truncate text-[11px] text-ink-3">{shareLink.link}</p>
                    </div>

                    {shareLinkCreatedAt ? (
                      <p className="text-[10px] text-ink-4">Generated {shareLinkCreatedAt}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateShareLink}
                    disabled={isLoadingShareLink || isSavingShareLink}
                    className={cn(
                      "h-8 rounded-md border-[0.5px] px-3 text-[11px] font-medium transition-colors",
                      "border-cursor bg-cursor text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
                    )}
                  >
                    {shareLink.active ? "Regenerate link" : "Generate link"}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    disabled={!shareLink.active || !shareLink.link || isSavingShareLink}
                    className="h-8 rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy
                  </button>

                  <button
                    type="button"
                    onClick={handleRevokeShareLink}
                    disabled={!shareLink.active || isSavingShareLink}
                    className="h-8 rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>

                {isLoadingShareLink ? <p className="text-[11px] text-ink-4">Loading preview link...</p> : null}
                {shareFeedback ? <p className="text-[11px] text-ink-3">{shareFeedback}</p> : null}
                {shareError ? <p className="text-[11px] text-[hsl(0,72%,45%)]">{shareError}</p> : null}
              </>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Spellcheck</p>
          <div className="space-y-3 rounded-lg border-[0.5px] border-border bg-bg p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onSpellcheckPreferenceChange("system")}
                className={cn(
                  "h-8 rounded-md border-[0.5px] text-[12px] font-medium transition-colors",
                  spellcheckPreference === "system"
                    ? "border-ink bg-ink text-bg"
                    : "border-border bg-bg text-ink-3 hover:bg-muted hover:text-ink",
                )}
              >
                System
              </button>
              <button
                type="button"
                onClick={() => onSpellcheckPreferenceChange("off")}
                className={cn(
                  "h-8 rounded-md border-[0.5px] text-[12px] font-medium transition-colors",
                  spellcheckPreference === "off"
                    ? "border-ink bg-ink text-bg"
                    : "border-border bg-bg text-ink-3 hover:bg-muted hover:text-ink",
                )}
              >
                Off
              </button>
            </div>

            <p className="text-[11px] leading-relaxed text-ink-4">
              Language hint: <span className="font-medium text-ink-3">{spellcheckLanguage}</span>. Safari follows macOS
              Keyboard settings; Chrome and Edge use browser dictionaries.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Info</p>
          <dl className="space-y-2 rounded-lg border-[0.5px] border-border bg-bg p-3">
            <MetricRow label="Words" value={metrics.words.toLocaleString()} />
            <MetricRow label="Characters" value={metrics.characters.toLocaleString()} />
            <MetricRow label="Sentences" value={metrics.sentences.toLocaleString()} />
            <MetricRow label="Reading time" value={`${metrics.readingTimeMinutes} min`} />
            <MetricRow label="Pages" value={metrics.pages.toFixed(1)} />
          </dl>
        </section>
      </div>
    </aside>
  )
}

type MetricRowProps = {
  label: string
  value: string
}

function MetricRow({ label, value }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <dt className="text-ink-4">{label}</dt>
      <dd className="font-medium text-ink-2">{value}</dd>
    </div>
  )
}
