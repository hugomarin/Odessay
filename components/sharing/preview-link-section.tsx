"use client"

import { Clipboard, RefreshCw, X } from "lucide-react"
import type { PreviewLinkState } from "@/lib/services/contracts/sharing-service"
import { cn } from "@/lib/utils"

export const DEFAULT_PREVIEW_LINK_STATE: PreviewLinkState = {
  active: false,
  token: null,
  link: null,
  createdAt: null,
}

export type PreviewLinkSectionProps = {
  hasRemoteWriting: boolean
  isLoadingShareLink: boolean
  isSavingShareLink: boolean
  shareLink: PreviewLinkState
  shareError: string | null
  remoteFeatureMessage: string
  onGenerate: () => void
  onCopy: () => void
  onRevoke: () => void
  /** Extra wrapper classes; callers that need a leading divider pass it here. */
  className?: string
}

/**
 * Preview link controls shared by the Desk preview modal and the editor
 * properties panel (ODE-389). Both surfaces render the same markup; only the
 * wrapper's border differs, so it stays caller-owned via `className`.
 */
export function PreviewLinkSection({
  hasRemoteWriting,
  isLoadingShareLink,
  isSavingShareLink,
  shareLink,
  shareError,
  remoteFeatureMessage,
  onGenerate,
  onCopy,
  onRevoke,
  className,
}: PreviewLinkSectionProps) {
  return (
    <div className={cn("px-3 py-[11px]", className)}>
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
