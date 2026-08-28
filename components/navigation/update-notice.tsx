"use client"

import { Download, X } from "lucide-react"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { cn } from "@/lib/utils"

/**
 * Desktop update notice — the missing surface of the update pipeline.
 *
 * `lib/desktop/update-checker.ts` has always checked, downloaded, installed and
 * relaunched, and the sidebar has always called the check on mount. Nothing
 * rendered the result, so a released version could never reach anyone who was
 * not watching GitHub. This is that surface.
 *
 * Consent is the contract the checker states: nothing downloads until the
 * author presses Install.
 */
export function UpdateNotice({
  label,
  collapsed,
  installing,
  error,
  onInstall,
  onDismiss,
}: {
  /** e.g. "Artifact Studio 0.8.0 is available" — from `formatUpdateLabel`. */
  label: string
  collapsed: boolean
  installing: boolean
  error: string | null
  onInstall: () => void
  onDismiss: () => void
}) {
  // The collapsed rail is 52px: a card cannot live there, so the notice becomes
  // the one glyph, and the label moves into its tooltip.
  if (collapsed) {
    return (
      <ActionTooltip label={installing ? "Installing update…" : label} side="right">
        <button
          type="button"
          data-testid="update-notice-collapsed"
          onClick={onInstall}
          disabled={installing}
          aria-label={label}
          className="relative mx-auto mb-1 inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-default"
        >
          <Download
            className={cn("h-[17px] w-[17px]", installing && "animate-pulse")}
            strokeWidth={1.5}
          />
          {!installing ? (
            <span
              aria-hidden="true"
              className="absolute right-[7px] top-[7px] h-[6px] w-[6px] rounded-full bg-cursor ring-2 ring-bg"
            />
          ) : null}
        </button>
      </ActionTooltip>
    )
  }

  return (
    <div
      data-testid="update-notice"
      className="mx-2 mb-2 rounded-[10px] border-[0.5px] border-border bg-sb p-3"
    >
      <div className="flex items-start gap-2">
        <Download className="mt-[2px] h-[14px] w-[14px] shrink-0 text-ink-3" strokeWidth={1.5} />
        <p className="min-w-0 flex-1 text-[12px] font-medium leading-[1.35] text-ink">{label}</p>
        <button
          type="button"
          onClick={onDismiss}
          disabled={installing}
          aria-label="Dismiss update"
          className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink disabled:cursor-default disabled:opacity-40"
        >
          <X className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>
      </div>

      <p className="mt-1 text-[11px] leading-[1.45] text-ink-4">
        {installing
          ? "Downloading. Artifact Studio restarts on its own when it finishes."
          : "Installing restarts Artifact Studio. Your open artifacts come back."}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] leading-[1.45] text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onInstall}
        disabled={installing}
        className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] border-[0.5px] border-ink bg-ink px-2.5 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
      >
        {installing ? "Installing…" : "Install and restart"}
      </button>
    </div>
  )
}
