"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type ArtifactRowSelectionProps = {
  label: string;
  selected?: boolean;
  visible?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
};

/** Shared leading selection control for Desk and Workspace writing rows. */
export function ArtifactRowSelection({
  label,
  selected = false,
  visible = true,
  disabled = false,
  onToggle,
}: ArtifactRowSelectionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      className={cn(
        "ArtifactRowSelection inline-flex h-4 w-4 items-center justify-center rounded-[4px] border transition-all duration-150",
        selected
          ? "border-ink bg-ink text-bg"
          : "border-border bg-sb text-transparent hover:border-ink-3",
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        disabled && "cursor-default hover:border-border",
      )}
      data-section="artifact-row-selection"
      aria-label={label}
      aria-pressed={selected}
      title={disabled ? label : undefined}
    >
      <Check className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
