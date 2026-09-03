"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Clock3,
  HardDrive,
  History,
  Loader,
  Split,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DocumentState } from "@/lib/writings/document-state";
import { cn } from "@/lib/utils";

type DocumentStateBadgeVariant = "compact" | "full";

type DocumentStateBadgeProps = {
  state: DocumentState;
  variant?: DocumentStateBadgeVariant;
  className?: string;
};

type DocumentStateBadgeCopy = {
  label: string;
  tooltip: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  className: string;
};

export const DOCUMENT_STATE_BADGE_COPY: Record<
  DocumentState,
  DocumentStateBadgeCopy
> = {
  "cloud-only": {
    label: "Cloud only",
    tooltip:
      "This artifact has a cloud record but no local file on this machine.",
    icon: Cloud,
    className: "bg-[hsl(220,40%,94%)] text-[hsl(220,45%,42%)]",
  },
  "local-only": {
    label: "Local only",
    tooltip:
      "This artifact exists locally on this machine and has not been synced to the cloud.",
    icon: HardDrive,
    className: "bg-[hsl(22,55%,94%)] text-cursor",
  },
  synced: {
    label: "Synced",
    tooltip:
      "This artifact has both a cloud record and a local file on this machine.",
    icon: CheckCircle2,
    className: "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,30%)]",
  },
  pending: {
    label: "Syncing",
    tooltip:
      "This artifact has local changes queued for cloud sync or is retrying a sync.",
    icon: Clock3,
    className: "bg-[hsl(45,60%,91%)] text-[hsl(35,55%,32%)]",
  },
  "sync-failed": {
    label: "Sync failed",
    tooltip:
      "This artifact could not be synced. Its local copy remains available.",
    icon: AlertCircle,
    className: "bg-[hsl(0,72%,96%)] text-destructive",
  },
  archived: {
    label: "Cloud archived",
    tooltip:
      "This artifact has an archived cloud record and is no longer active in the cloud.",
    icon: History,
    className: "bg-[hsl(210,10%,92%)] text-[hsl(210,10%,40%)]",
  },
  conflict: {
    label: "Conflict",
    tooltip:
      "This artifact has local and cloud changes that conflict. Resolve them before editing — nothing is overwritten automatically.",
    icon: AlertTriangle,
    className: "bg-[hsl(0,72%,96%)] text-destructive",
  },
  ambiguous: {
    label: "Needs review",
    tooltip:
      "This file matches more than one artifact. Pick which one to open before editing.",
    icon: Split,
    className: "bg-[hsl(45,60%,91%)] text-[hsl(35,55%,32%)]",
  },
  stale: {
    label: "Reconnecting",
    tooltip:
      "The file watcher is catching up. This record is shown from the last known catalog state and will refresh automatically.",
    icon: History,
    className: "bg-[hsl(210,10%,92%)] text-[hsl(210,10%,40%)]",
  },
  rebuilding: {
    label: "Rebuilding",
    tooltip:
      "The local catalog is being rebuilt from your files and the cloud. Your artifacts are safe; this view will refresh when it finishes.",
    icon: Loader,
    className: "bg-[hsl(210,10%,92%)] text-[hsl(210,10%,40%)]",
  },
};

export function DocumentStateTooltipProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <TooltipProvider delayDuration={120}>{children}</TooltipProvider>;
}

export function DocumentStateBadge({
  state,
  variant = "full",
  className,
}: DocumentStateBadgeProps) {
  const copy = DOCUMENT_STATE_BADGE_COPY[state];
  const Icon = copy.icon;
  const isCompact = variant === "compact";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={`Artifact state: ${copy.label}`}
          data-testid="document-state-badge"
          data-document-state={state}
          className={cn(
            "inline-flex items-center gap-[5px] rounded-[6px] border-[0.5px] border-transparent font-sans font-medium",
            copy.className,
            isCompact
              ? "px-[6px] py-[2px] text-[10px]"
              : "px-2 py-0.5 text-[11px]",
            className,
          )}
        >
          <Icon
            className={isCompact ? "h-[10px] w-[10px]" : "h-[11px] w-[11px]"}
            strokeWidth={1.5}
          />
          {copy.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        {copy.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
