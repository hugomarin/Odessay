"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { DocumentStateIcon } from "@/components/ui/document-state-icon";
import type { DocumentState } from "@/lib/writings/document-state";
import { cn } from "@/lib/utils";

type ArtifactWritingCellProps = {
  title: string;
  documentState: DocumentState;
  description?: string | null;
  loadDescription?: () => Promise<string | null>;
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
  loadDescription,
  dateLabel,
  actions,
  collections,
  className,
}: ArtifactWritingCellProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const loadDescriptionRef = useRef(loadDescription);
  const [resolvedDescription, setResolvedDescription] = useState(
    description?.trim() || null,
  );

  loadDescriptionRef.current = loadDescription;

  useEffect(() => {
    const suppliedDescription = description?.trim() || null;
    setResolvedDescription(suppliedDescription);
    if (suppliedDescription || !loadDescriptionRef.current) {
      return;
    }

    let active = true;
    let requested = false;
    const load = () => {
      if (requested) return;
      requested = true;
      void loadDescriptionRef
        .current?.()
        .then((value) => {
          if (!active) return;
          const normalized = value?.replace(/\s+/g, " ").trim() || null;
          setResolvedDescription(
            normalized && normalized.length > 160
              ? `${normalized.slice(0, 157)}...`
              : normalized,
          );
        })
        .catch(() => {
          // The row remains usable without an excerpt when the local file is
          // temporarily unavailable; opening the document owns error recovery.
        });
    };

    if (typeof IntersectionObserver === "undefined" || !rootRef.current) {
      load();
      return () => {
        active = false;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(rootRef.current);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [description]);

  return (
    <div
      ref={rootRef}
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

      {resolvedDescription ? (
        <p className="line-clamp-2 pt-1.5 font-sans text-[13px] leading-[1.45] text-ink-3">
          {resolvedDescription}
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
