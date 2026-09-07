"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { ArrowLeft, ArrowRight, MoreHorizontal, X } from "lucide-react"

import { DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { useSingleModalGuard } from "@/components/ui/overlay-core"
import { cn } from "@/lib/utils"

export type WorkspaceAgentReviewPill = {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

export type WorkspaceAgentReviewShellProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pager text on the left of the header, e.g. "1 de 2", "3 candidatos", "Borrador 1". */
  pagerLabel: string
  /** Uppercase action label next to the pager, e.g. "Referencias rotas", "Classify". */
  actionLabel: string
  onBack?: () => void
  onForward?: () => void
  backDisabled?: boolean
  forwardDisabled?: boolean
  /** Optional white pill button in the header, e.g. "Abrir el artifact" or "4 documentos". */
  pill?: WorkspaceAgentReviewPill
  /** Optional footer bar (summary text + Cancelar + primary CTA) — omit when the body carries its own actions in a right rail. */
  footer?: React.ReactNode
  children: React.ReactNode
  testId?: string
}

/**
 * Shared 1080px chrome for every Workspace agent review — Broken links,
 * Workflow, Classify, Archive, Contradictions, Merge. Built on the same
 * Dialog primitives as the rest of the app (FormModal, etc.) rather than the
 * design handoff's absolute-positioned-inside-a-fixed-1440x900-shell overlay,
 * since this app has no such fixed shell — a real, viewport-anchored modal
 * matches how every other overlay in Odessay behaves.
 */
export function WorkspaceAgentReviewShell({
  open,
  onOpenChange,
  pagerLabel,
  actionLabel,
  onBack,
  onForward,
  backDisabled,
  forwardDisabled,
  pill,
  footer,
  children,
  testId,
}: WorkspaceAgentReviewShellProps) {
  useSingleModalGuard(open, `WorkspaceAgentReviewShell(${actionLabel})`)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-[6px] bg-[rgba(35,24,15,0.24)]" />
        <DialogPrimitive.Content
          aria-modal="true"
          data-testid={testId ?? "workspace-agent-review-shell"}
          className="fixed left-1/2 top-1/2 z-50 flex h-[calc(100vh-48px)] w-[1080px] max-w-[calc(100vw-132px)] -translate-x-1/2 -translate-y-1/2 animate-modal-in flex-col overflow-hidden rounded-[18px] bg-[#F7F5F3] font-sans shadow-[0_30px_90px_rgba(35,24,15,0.28),0_2px_6px_rgba(35,24,15,0.10)]"
        >
          <header className="flex h-[52px] shrink-0 items-center gap-2.5 pl-4 pr-3.5">
            <button
              type="button"
              aria-label="Back"
              disabled={!onBack || backDisabled}
              onClick={onBack}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Forward"
              disabled={!onForward || forwardDisabled}
              onClick={onForward}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ArrowRight className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
            <span className="whitespace-nowrap text-[13px] text-ink">{pagerLabel}</span>
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">{actionLabel}</span>
            <span className="flex-1" />
            {pill ? (
              <button
                type="button"
                onClick={pill.onClick}
                disabled={!pill.onClick}
                className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border-[0.5px] border-border bg-sb px-3 text-[13px] font-medium text-[#3F3731] transition-colors hover:border-[#CFC9C1] disabled:cursor-default"
              >
                <span className="text-ink-4 [&>svg]:h-4 [&>svg]:w-4">{pill.icon}</span>
                {pill.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="More options"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink"
            >
              <MoreHorizontal className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink"
              >
                <X className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </button>
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            {children}
          </div>

          {footer ? (
            <div className="flex shrink-0 items-center gap-2.5 px-4 pb-3.5 pt-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

export function ReviewShellCancelButton({ onClick, label = "Cancelar" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center rounded-[9px] px-3.5 text-[13px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink"
    >
      {label}
    </button>
  )
}

export function ReviewShellPrimaryButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 items-center gap-2 rounded-[9px] bg-ink px-4 text-[13px] font-medium text-bg transition-colors hover:bg-[#3F3731] disabled:opacity-50",
      )}
    >
      {icon}
      {children}
    </button>
  )
}
