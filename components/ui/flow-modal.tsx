"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ArrowLeft, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { DiscardConfirm, useOverlayCloseGuard, useSingleModalGuard } from "@/components/ui/overlay-core"

/**
 * Flow modal — add workspace, import, manage included files.
 *
 * 640px, radius 18, `max-height: calc(100vh - 48px)`, flex column with a fixed
 * header and footer and a scrolling middle. Geometry read from the render of
 * `docs/design/reference/Artifact Studio Add Workspace.dc.html`.
 *
 * A modal never opens from a modal: multi-screen work is `FlowModalStep`s of
 * one flow modal, which is what keeps add-workspace's five screens legal.
 */

export interface FlowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible name of the flow. Rendered by `FlowModalHeader` when passed there. */
  title: string
  /** A field holds unsaved input: a scrim click asks before discarding. */
  dirty?: boolean
  discardMessage?: string
  onBack?: () => void
  hideClose?: boolean
  className?: string
  children: React.ReactNode
}

export function FlowModal({
  open,
  onOpenChange,
  title,
  dirty = false,
  discardMessage,
  onBack,
  hideClose,
  className,
  children
}: FlowModalProps) {
  useSingleModalGuard(open, `FlowModal(${title})`)
  const guard = useOverlayCloseGuard({ open, dirty, onClose: () => onOpenChange(false) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-label={title}
          aria-modal="true"
          data-testid="flow-modal"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[640px] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 animate-modal-in flex-col overflow-hidden rounded-modal border-[0.5px] border-border bg-sb font-sans shadow-modal",
            className
          )}
          {...guard.contentProps}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="absolute left-[18px] top-[18px] z-[2] flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink"
            >
              <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
          )}

          {!hideClose && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-[18px] top-[18px] z-[2] flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink"
            >
              <X className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </DialogPrimitive.Close>
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

/**
 * Fixed header. It shrinks before the content does — the scrolling middle keeps
 * its 150px, the header gives up its space first.
 */
export function FlowModalHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="flow-modal-header"
      className={cn("flex-shrink-0 px-9 pb-4 pt-9", className)}
      {...props}
    >
      {children}
    </div>
  )
}

/** Scrolling middle. `min-height: 150px` is the floor the header yields to. */
export function FlowModalBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="flow-modal-body"
      className={cn("od-scroll min-h-[150px] flex-1 overflow-y-auto px-[30px] pb-2.5", className)}
      {...props}
    >
      {children}
    </div>
  )
}

/** Fixed footer with the hairline over it, actions right-aligned. */
export function FlowModalFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="flow-modal-footer"
      className={cn(
        "flex flex-shrink-0 items-center justify-end gap-2.5 border-t-[0.5px] border-line-soft px-[30px] py-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface FlowModalStepProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Changing the key replays `odStepIn` — one step per screen of the flow. */
  stepKey: string
}

/**
 * One screen of the flow. Wraps its content in the 220ms `odStepIn` entrance
 * and remounts on `stepKey` so every step animates, not only the first.
 */
export function FlowModalStep({ stepKey, className, children, ...props }: FlowModalStepProps) {
  return (
    <div
      key={stepKey}
      data-testid="flow-modal-step"
      data-step={stepKey}
      className={cn("flex min-h-0 flex-1 animate-step-in flex-col", className)}
      {...props}
    >
      {children}
    </div>
  )
}
