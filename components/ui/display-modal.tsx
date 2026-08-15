"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { DiscardConfirm, useOverlayCloseGuard, useSingleModalGuard } from "@/components/ui/overlay-core"

/**
 * Display modal — keyboard shortcuts and anything else that is read, not filled.
 *
 * 720–860px, radius 18, Lora 34/500 title, scrolls internally
 * (docs/design/overlays.md · docs/design/layout.md §4).
 */

const DISPLAY_MODAL_WIDTH = {
  720: "max-w-[720px]",
  800: "max-w-[800px]",
  860: "max-w-[860px]"
} as const

export interface DisplayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  width?: keyof typeof DISPLAY_MODAL_WIDTH
  /** Display modals rarely hold input; kept for the ones that do. */
  dirty?: boolean
  discardMessage?: string
  hideClose?: boolean
  className?: string
  children: React.ReactNode
}

export function DisplayModal({
  open,
  onOpenChange,
  title,
  description,
  width = 860,
  dirty = false,
  discardMessage,
  hideClose,
  className,
  children
}: DisplayModalProps) {
  useSingleModalGuard(open, `DisplayModal(${title})`)
  const guard = useOverlayCloseGuard({ open, dirty, onClose: () => onOpenChange(false) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-modal="true"
          data-testid="display-modal"
          className={cn(
            "od-scroll fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-48px)] w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 animate-modal-in overflow-y-auto rounded-modal border-[0.5px] border-border bg-sb px-10 pb-10 pt-9 font-sans shadow-modal",
            DISPLAY_MODAL_WIDTH[width],
            className
          )}
          {...guard.contentProps}
        >
          {!hideClose && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-[18px] top-[18px] flex h-8 w-8 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </DialogPrimitive.Close>
          )}

          <DialogPrimitive.Title className="mb-3 font-lora text-[34px] font-medium leading-[1.15] tracking-[-0.02em] text-ink">
            {title}
          </DialogPrimitive.Title>

          {description && (
            <DialogPrimitive.Description className="mb-6 max-w-[70ch] text-sm leading-relaxed text-ink-3">
              {description}
            </DialogPrimitive.Description>
          )}

          {children}

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
