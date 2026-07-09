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
          aria-label={`Document state: ${copy.label}`}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
            copy.className,
            className,
          )}
        >
          <Icon className="h-[11px] w-[11px]" strokeWidth={1.5} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {copy.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
