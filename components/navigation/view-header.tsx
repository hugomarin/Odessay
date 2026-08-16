"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The header every view wears, so the title lands on the same pixel whatever
 * page you are on.
 *
 * Geometry from Desk, which is the reference: padding `12px 16px 16px`, the
 * 40px title and its 14px subtitle baseline-aligned 16px apart, the actions
 * flush right and bottom-aligned with the title.
 *
 * **The subtitle line is where a breadcrumb goes too.** Detail views used to
 * stack their back-link above the title, which pushed the title down and made
 * every page start at a different height — the whole point of this component
 * is that they don't. Anything contextual rides beside the title, never above.
 */
export function ViewHeader({
  title,
  subtitle,
  adornment,
  actions,
  sectionId = "view-header",
  testId = "view-header",
  className,
}: {
  title: ReactNode
  /** Sits on the title's baseline: a description, a breadcrumb, a path. */
  subtitle?: ReactNode
  /** Controls that belong to the title itself, e.g. its overflow menu. */
  adornment?: ReactNode
  actions?: ReactNode
  sectionId?: string
  testId?: string
  className?: string
}) {
  return (
    <div
      data-section={sectionId}
      data-testid={testId}
      data-tauri-drag-region
      className={cn("flex flex-shrink-0 items-end gap-5 px-4 pb-4 pt-3", className)}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-4">
        <h1
          data-tauri-drag-region
          className="flex-shrink-0 text-[40px] font-medium leading-none tracking-[-0.02em] text-ink"
        >
          {title}
        </h1>
        {adornment ? (
          <span className="flex flex-shrink-0 items-center self-center">{adornment}</span>
        ) : null}
        {subtitle ? (
          <div
            data-tauri-drag-region
            className="min-w-0 text-pretty text-[14px] font-normal leading-[1.5] text-ink-4"
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-[9px]">{actions}</div> : null}
    </div>
  )
}

/** The ink pill every view uses for its one primary action. */
export const VIEW_HEADER_ACTION_CLASS =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[9px] bg-ink px-[17px] text-[16px] font-medium text-bg transition-opacity hover:opacity-90"
