"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { DiscardConfirm, useOverlayCloseGuard, useSingleModalGuard } from "@/components/ui/overlay-core"

/**
 * Full overlay — artifact preview and search.
 *
 * `inset: 0` over the scrim, with its own 48px chrome row; the content below it
 * is centered with the view's own max-width (docs/design/layout.md §4).
 */

export interface FullOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible name of the overlay. */
  title: string
  /** Shown in the chrome row unless `hideTitle`. */
  hideTitle?: boolean
  /** Chrome row content left of the title, e.g. ← → navigation. */
  chromeStart?: React.ReactNode
  /** Chrome row content right of the title, e.g. "Open full writing". */
  chromeEnd?: React.ReactNode
  dirty?: boolean
  discardMessage?: string
  hideClose?: boolean
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

export function FullOverlay({
  open,
  onOpenChange,
  title,
  hideTitle,
  chromeStart,
  chromeEnd,
  dirty = false,
  discardMessage,
  hideClose,
  className,
  contentClassName,
  children
}: FullOverlayProps) {
  useSingleModalGuard(open, `FullOverlay(${title})`)
  const guard = useOverlayCloseGuard({ open, dirty, onClose: () => onOpenChange(false) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-modal="true"
          data-testid="full-overlay"
          className={cn(
            "fixed inset-0 z-50 flex animate-modal-in flex-col bg-bg font-sans",
            className
          )}
          {...guard.contentProps}
        >
          <div
            data-testid="full-overlay-chrome"
            className="flex h-12 flex-shrink-0 items-center gap-2.5 px-2"
          >
            {chromeStart}
            {hideTitle ? (
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
            ) : (
              <DialogPrimitive.Title className="truncate text-[13px] font-normal text-ink-2">
                {title}
              </DialogPrimitive.Title>
            )}
            <span className="flex-1" />
            {chromeEnd}
            {!hideClose && (
              <DialogPrimitive.Close
                aria-label="Close"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink"
              >
                <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </DialogPrimitive.Close>
            )}
          </div>

          <div className={cn("od-scroll min-h-0 flex-1 overflow-y-auto", contentClassName)}>{children}</div>

          <DiscardConfirm
            open={guard.confirming}
            onCancel={guard.cancelClose}
            onDiscard={guard.confirmClose}
            message={discardMessage}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
