"use client";

import type { ReactNode } from "react";
import { DocumentStateIcon } from "@/components/ui/document-state-icon";
import type { DocumentState } from "@/lib/writings/document-state";
import { cn } from "@/lib/utils";

type ArtifactWritingCellProps = {
  title: string;
  documentState: DocumentState;
  description?: string | null;
  localPath?: string | null;
  dateLabel?: string | null;
  actions?: ReactNode;
  collections?: ReactNode;
  className?: string;
};

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
  localPath,
  dateLabel,
  actions,
  collections,
  className,
}: ArtifactWritingCellProps) {
  const resolvedDescription = description?.trim() || null;
  const resolvedLocalPath = localPath?.trim() || null;
  const locationLabel = resolvedLocalPath
    ? `file://${resolvedLocalPath}`
    : undefined;

  return (
    <div
      className={cn("ArtifactWritingCell min-w-0", className)}
      data-section="artifact-writing-cell"
      title={locationLabel}
    >
      {locationLabel ? (
        <span className="sr-only" data-section="artifact-writing-location">
          {locationLabel}
        </span>
      ) : null}
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

      {dateLabel || resolvedDescription ? (
        <p className="mt-1.5 flex min-w-0 items-center gap-2 overflow-hidden font-sans text-[13px] leading-[1.45] text-ink-3">
          {dateLabel ? (
            <span className="shrink-0 text-ink-4">{dateLabel}</span>
          ) : null}
          {dateLabel && resolvedDescription ? (
            <span className="shrink-0 text-ink-4" aria-hidden="true">
              ·
            </span>
          ) : null}
          {resolvedDescription ? (
            <span className="truncate">{resolvedDescription}</span>
          ) : null}
        </p>
      ) : null}

      {collections ? (
        <div className="mt-1.5 flex min-w-0 items-start">{collections}</div>
      ) : null}
    </div>
  );
}

type ArtifactWritingActionProps = {
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  children: ReactNode;
};

export function ArtifactWritingAction({
  label,
  onClick,
  disabled = false,
  children,
}: ArtifactWritingActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ArtifactWritingAction inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-[background-color,color] duration-150 hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-ink-4"
      data-section="artifact-writing-action"
      aria-label={label}
      title={disabled ? label : undefined}
    >
      {children}
    </button>
  );
}
