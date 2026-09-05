"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DOCUMENT_STATE_BADGE_COPY } from "@/components/ui/document-state-badge";
import type { DocumentState } from "@/lib/writings/document-state";
import { cn } from "@/lib/utils";

export function DocumentStateIcon({
  state,
  className,
}: {
  state: DocumentState;
  className?: string;
}) {
  const copy = DOCUMENT_STATE_BADGE_COPY[state];
  const Icon = copy.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={`Artifact state: ${copy.label}`}
          className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center text-ink-4", className)}
        >
          <Icon className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {copy.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
