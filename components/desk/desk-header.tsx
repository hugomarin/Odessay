"use client"

import Link from "next/link"
import { Plus, Upload } from "lucide-react"

/**
 * Desk header — `h1`, subtitle and the primary action.
 *
 * Values from the prototype: padding `12px 16px 16px`, the title and subtitle
 * baseline-aligned 16px apart, the primary action a 40px ink button at radius 9
 * with a 15px `plus`.
 */
export function DeskHeader({ onImport }: { onImport?: () => void }) {
  return (
    <div
      data-section="desk-header"
      data-testid="desk-header"
      className="flex flex-shrink-0 items-end gap-5 px-4 pb-4 pt-3"
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-4">
        <h1 className="text-[32px] font-medium leading-none tracking-[-0.02em] text-ink">Desk</h1>
        <p className="text-pretty text-[14px] font-normal leading-[1.5] text-ink-4">
          Writing activity, shared drafts, and collection context.
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-[9px]">
        {onImport ? (
          <button
            type="button"
            onClick={onImport}
            data-testid="desk-import-button"
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[9px] border-[0.5px] border-border bg-sb px-[15px] text-[14px] text-ink-2 transition-colors hover:bg-surface-row-hover"
          >
            <Upload className="h-[15px] w-[15px]" strokeWidth={1.5} />
            Import
          </button>
        ) : null}
        <Link
          href="/write?new=1"
          data-testid="desk-new-artifact"
          className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[9px] bg-ink px-[17px] text-[14px] font-medium text-bg transition-opacity hover:opacity-90"
        >
          <Plus className="h-[15px] w-[15px]" strokeWidth={1.5} />
          New Artifact
        </Link>
      </div>
    </div>
  )
}
