"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  ChevronDown,
  Clipboard,
  Download,
  FileText,
  FileType,
  RefreshCw,
  X,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { EditorSpellcheckPreference } from "@/lib/editor/spellcheck"
import type { TextMetrics } from "@/lib/editor/text-metrics"
import type { WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { cn } from "@/lib/utils"
import { getWritingStatusLabel } from "@/lib/writings/status"
import { WritingCollectionsSection } from "./writing-collections-section"
import { WritingSharesSection } from "./writing-shares-section"

type PropertiesPanelProps = {
  writingId: string | null
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

type ExportFormat = "markdown" | "pdf" | "docx"

const STATUS_OPTIONS: WritingStatus[] = ["new", "exploring", "draft", "done"]

const DEFAULT_SHARE_LINK_STATE: ShareLinkState = {
  active: false,
  token: null,
  link: null,
  createdAt: null,
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

function WritingStatusIcon({ status, className }: { status: WritingStatus; className?: string }) {
  if (status === "new") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={cn("h-[13px] w-[13px]", className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10" strokeDasharray="3.5 2.5" />
      </svg>
    )
  }

  if (status === "exploring") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={cn("h-[13px] w-[13px]", className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4l2 2" />
      </svg>
    )
  }

  if (status === "done") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={cn("h-[13px] w-[13px]", className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="m8 12 3 3 5-5" />
      </svg>
    )
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("h-[13px] w-[13px]", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

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
  writingId,
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
  const [shareError, setShareError] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingDocx, setIsExportingDocx] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const shareApiPath = writingId ? `/api/writings/${writingId}/share-test-link` : null
  const spellcheckEnabled = spellcheckPreference !== "off"

  const loadShareLink = useCallback(async () => {
    if (!shareApiPath) {
      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareError(null)
      return
    }

    setIsLoadingShareLink(true)
    setShareError(null)

    try {
      const response = await fetch(shareApiPath, { method: "GET" })
      const payload = (await response.json()) as ApiEnvelope<ShareLinkState>

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to load preview link.")
      }

      setShareLink(payload.data)
    } catch (error) {
      setShareLink(DEFAULT_SHARE_LINK_STATE)
      setShareError(error instanceof Error ? error.message : "Failed to load preview link.")
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

    try {
      const response = await fetch(shareApiPath, { method: "POST" })
      const payload = (await response.json()) as ApiEnvelope<ShareLinkState & { replacedPrevious?: boolean }>

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to generate preview link.")
      }

      setShareLink(payload.data)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to generate preview link.")
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

    try {
      const response = await fetch(shareApiPath, { method: "DELETE" })
      const payload = (await response.json()) as ApiEnvelope<{ active: boolean; revoked: boolean }>

      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Failed to revoke preview link.")
      }

      setShareLink(DEFAULT_SHARE_LINK_STATE)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Failed to revoke preview link.")
    } finally {
      setIsSavingShareLink(false)
    }
  }, [shareApiPath])

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
          await onExportMarkdown()
          setExportFeedback("Markdown export generated.")
        } else if (format === "pdf") {
          await onExportPdf()
          setExportFeedback("PDF export generated.")
        } else {
          await onExportDocx()
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
      className="EditorPanelProperties fixed right-0 top-[46px] bottom-8 z-40 w-[248px] overflow-y-auto border-l-[0.5px] border-border bg-sb"
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
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <div>
                <DropdownTrigger
                  open={statusOpen}
                  icon={<WritingStatusIcon status={status} />}
                  label={getWritingStatusLabel(status)}
                />
              </div>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[216px] p-[5px]">
              {STATUS_OPTIONS.map((option) => (
                <PopoverItem
                  key={option}
                  selected={option === status}
                  icon={<WritingStatusIcon status={option} />}
                  label={getWritingStatusLabel(option)}
                  onSelect={() => {
                    onStatusChange(option)
                    setStatusOpen(false)
                  }}
                />
              ))}
            </PopoverContent>
          </Popover>
        </section>

        {writingId ? <WritingCollectionsSection writingId={writingId} /> : null}

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Sharing</p>
          <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
            {writingId ? (
              <WritingSharesSection
                writingId={writingId}
                onSharesStateChange={handleSharesStateChange}
              />
            ) : null}

            <div className="px-3 py-[11px]">
              <div className="mb-2">
                <p className="text-[12px] font-medium text-ink-2">Preview link</p>
                <p className="mt-0.5 text-[11px] leading-[1.45] text-ink-4">
                  Share with anyone — no Odessay account needed.
                </p>
              </div>

              {!shareLink.active || !shareLink.link ? (
                <button
                  type="button"
                  onClick={handleGenerateShareLink}
                  disabled={!writingId || isLoadingShareLink || isSavingShareLink}
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
                      onClick={() => void handleCopyShareLink()}
                      disabled={isSavingShareLink}
                      className="inline-flex h-7 min-w-0 items-center justify-center gap-[5px] rounded-[6px] border-[0.5px] border-border bg-bg px-[10px] text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Clipboard className="h-[11px] w-[11px]" strokeWidth={1.5} />
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerateShareLink()}
                      disabled={isSavingShareLink}
                      className="inline-flex h-7 min-w-0 items-center justify-center gap-[5px] rounded-[6px] border-[0.5px] border-border bg-bg px-[10px] text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-[11px] w-[11px]" strokeWidth={1.5} />
                      Regenerate
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevokeShareLink()}
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
                disabled={!writingId || isExportingPdf}
              />
              <PopoverItem
                label={isExportingDocx ? "Exporting Word..." : "Word (.docx)"}
                icon={<FileType className="h-[13px] w-[13px]" strokeWidth={1.5} />}
                onSelect={() => void handleExport("docx")}
                disabled={!writingId || isExportingDocx}
              />
              <div className="my-1 h-px bg-border" />
              <p className="px-[10px] pb-1 pt-1.5 text-[10px] leading-[1.4] text-ink-4">
                Markdown is local. PDF and Word require a saved writing.
              </p>
            </PopoverContent>
          </Popover>
          {exportFeedback ? <p className="text-[11px] text-ink-3">{exportFeedback}</p> : null}
          {exportError ? <p className="text-[11px] text-[hsl(0,72%,45%)]">{exportError}</p> : null}
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Spellcheck</p>
          <div className="overflow-hidden rounded-[8px] border-[0.5px] border-border bg-bg">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-border px-3 py-[10px]">
              <span className="text-[12px] font-medium text-ink-2">Enable</span>
              <button
                type="button"
                role="switch"
                aria-checked={spellcheckEnabled}
                aria-label="Enable spellcheck"
                onClick={() => onSpellcheckPreferenceChange(spellcheckEnabled ? "off" : "system")}
                className={cn(
                  "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  spellcheckEnabled ? "bg-ink" : "bg-[hsl(32_20%_86%)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute top-0.5 h-[14px] w-[14px] rounded-full bg-bg transition-transform",
                    spellcheckEnabled ? "translate-x-[15px]" : "translate-x-[2px]",
                  )}
                />
              </button>
            </div>
            <p className="px-3 pb-[10px] pt-0 text-[11px] leading-[1.5] text-ink-4">
              Language hint: <span className="font-semibold text-ink-3">{spellcheckLanguage}</span>. Safari uses macOS Keyboard settings; Chrome and Edge use browser dictionaries.
            </p>
          </div>
        </section>

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
      </div>
    </aside>
  )
}
