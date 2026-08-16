"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { DiscardConfirm, useOverlayCloseGuard, useSingleModalGuard } from "@/components/ui/overlay-core"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-scrim", className)} {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean
    overlayClassName?: string
  }
>(({ className, children, hideClose, overlayClassName, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 animate-modal-in gap-4 rounded-modal border-[0.5px] border-border bg-sb p-6 font-sans shadow-modal",
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-ink-4 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg disabled:pointer-events-none">
          <X className="h-4 w-4" strokeWidth={1.5} />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-lora text-xl font-medium leading-none tracking-[-0.01em] text-ink", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm font-sans leading-relaxed text-ink-3", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

/* ------------------------------------------------------------------- form modal */

const FORM_MODAL_WIDTH = {
  440: "w-[440px]",
  480: "w-[480px]",
  520: "w-[520px]"
} as const

export interface FormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Visible title. Also the accessible name of the dialog. */
  title: string
  /** Optional line under the title — the prototype uses it for the item kind. */
  description?: string
  /** Small caps label above the title, e.g. "Artifact name". */
  overline?: string
  /** Leading 36px chip, e.g. the type icon. */
  chip?: React.ReactNode
  /** 440 for rename and confirmations, 520 for the type / status editor. */
  width?: keyof typeof FORM_MODAL_WIDTH
  /** A field holds unsaved input: a scrim click asks before discarding. */
  dirty?: boolean
  discardMessage?: string
  footer?: React.ReactNode
  hideClose?: boolean
  className?: string
  children?: React.ReactNode
}

/**
 * Form modal — rename, delete confirmations, the type / status editor.
 * Geometry from docs/design/overlays.md: 440–520px, radius 18, padding 22–36.
 */
function FormModal({
  open,
  onOpenChange,
  title,
  description,
  overline,
  chip,
  width = 440,
  dirty = false,
  discardMessage,
  footer,
  hideClose,
  className,
  children
}: FormModalProps) {
  useSingleModalGuard(open, `FormModal(${title})`)
  const guard = useOverlayCloseGuard({ open, dirty, onClose: () => onOpenChange(false) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-modal="true"
          data-testid="form-modal"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 animate-modal-in flex-col overflow-hidden rounded-modal border-[0.5px] border-border bg-sb font-sans shadow-modal",
            FORM_MODAL_WIDTH[width],
            className
          )}
          {...guard.contentProps}
        >
          <div className="flex flex-shrink-0 items-center gap-3.5 px-[22px] pb-[18px] pt-[22px]">
            {chip}
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {overline && (
                <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.13em] text-ink-4">
                  {overline}
                </span>
              )}
              <DialogPrimitive.Title className="truncate text-xl font-medium leading-tight tracking-[-0.01em] text-ink">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-xs leading-snug text-ink-5">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {!hideClose && (
              <DialogPrimitive.Close
                aria-label="Close"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-colors hover:bg-surface-menu-hover hover:text-ink"
              >
                <X className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </DialogPrimitive.Close>
            )}
          </div>

          {/* The scroller clips horizontally as well as vertically, which used
              to slice the focus ring off any autofocused field. Padding the
              scroll box and pulling the content back keeps the halo whole. */}
          <div className="od-scroll -mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
            {/* 6px of scroller padding + 16px here keeps the original 22px. */}
            <div className="px-4">{children}</div>
          </div>

          {footer && (
            <div className="flex flex-shrink-0 items-center justify-end gap-2.5 border-t-[0.5px] border-line-soft px-[22px] py-3.5">
              {footer}
            </div>
          )}

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

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  FormModal
}
