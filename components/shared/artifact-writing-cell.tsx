"use client"

import type { ReactNode } from "react"

import { DocumentStateIcon } from "@/components/ui/document-state-icon"
import type { DocumentState } from "@/lib/writings/document-state"
import { cn } from "@/lib/utils"

type ArtifactWritingCellProps = {
  title: string
  documentState: DocumentState
  description?: string | null
  dateLabel?: string | null
  actions?: ReactNode
  collections?: ReactNode
  className?: string
}

/**
 * Shared writing-cell markup for Desk and Workspace rows.
 *
 * The surrounding table owns navigation and property columns; this component
 * keeps the writing hierarchy and rhythm identical across both catalog views.
 */
export function ArtifactWritingCell({
  title,
  documentState,
  description,
  dateLabel,
  actions,
  collections,
  className,
}: ArtifactWritingCellProps) {
  return (
    <div
      className={cn("ArtifactWritingCell min-w-0", className)}
      data-section="artifact-writing-cell"
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 shrink truncate font-sans text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
          {title}
        </p>
        <DocumentStateIcon
          state={documentState}
          className="h-5 w-5 rounded-[6px]"
        />
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>

      {description ? (
        <p className="line-clamp-2 pt-1.5 font-sans text-[13px] leading-[1.45] text-ink-3">
          {description}
        </p>
      ) : null}

      {dateLabel || collections ? (
        <div className="mt-2 flex min-w-0 flex-col items-start gap-1.5">
          {dateLabel ? (
            <p className="font-sans text-[11px] leading-[1.35] text-ink-4">
              {dateLabel}
            </p>
          ) : null}
          {collections}
        </div>
      ) : null}
    </div>
  )
}

type ArtifactWritingActionProps = {
  label: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}

export function ArtifactWritingAction({
  label,
  onClick,
  children,
}: ArtifactWritingActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ArtifactWritingAction inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-[background-color,color] duration-150 hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
      data-section="artifact-writing-action"
      aria-label={label}
    >
      {children}
    </button>
  )
}
