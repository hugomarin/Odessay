"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type VocabularyDeleteConfirmProps = {
  open: boolean
  kind: "type" | "status"
  itemName: string
  /** `null` means the count could not be taken — requirement 7: never shown as zero. */
  usage: number | null
  isDeleting?: boolean
  errorMessage?: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * The delete confirmation — the only genuinely new element in the ODE-475
 * package. Built from the closed overlay inventory's "in-flow confirmation"
 * pattern (`DiscardConfirm` in `components/ui/overlay-core.tsx`): an
 * absolutely-positioned layer inside the *same* modal, not a second stacked
 * Dialog — requirement 6, "nunca hay dos overlays simultáneos".
 */
export function VocabularyDeleteConfirm({
  open,
  kind,
  itemName,
  usage,
  isDeleting = false,
  errorMessage,
  onCancel,
  onConfirm,
}: VocabularyDeleteConfirmProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  if (!open) return null

  const baseValue = kind === "type" ? "General" : "Draft"
  const usageMessage =
    usage === null
      ? `We couldn't count how many artifacts use this ${kind} right now. Deleting it will still rewrite every one of them to ${baseValue}.`
      : usage === 0
        ? `No artifacts use this ${kind} right now.`
        : `${usage} artifact${usage === 1 ? "" : "s"} will be rewritten to ${baseValue}.`

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`Delete ${kind} "${itemName}"`}
      data-testid="vocabulary-delete-confirm"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-sb/95 px-8 text-center font-sans"
    >
      <p className="text-[15px] font-medium leading-tight text-ink">
        Delete {kind} «{itemName}»
      </p>
      <p className="max-w-[38ch] text-sm leading-relaxed text-ink-2">{usageMessage}</p>
      {errorMessage ? (
        <p role="alert" className="max-w-[38ch] text-[13px] leading-relaxed text-destructive">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={isDeleting}
          className="inline-flex h-9 items-center rounded-[9px] border-[0.5px] border-border bg-sb px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDeleting}
          className={cn(
            "inline-flex h-9 items-center rounded-[9px] px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted hover:text-cursor disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {isDeleting ? "Deleting…" : `Delete ${kind}`}
        </button>
      </div>
    </div>
  )
}
