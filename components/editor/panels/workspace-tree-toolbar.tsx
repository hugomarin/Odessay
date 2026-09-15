"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Filter, Folder, Shapes, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WritingStatusIcon } from "@/components/ui/writing-status-icon";
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon";
import { useVocabulary } from "@/hooks/useVocabulary";
import { listVisibleVocabulary } from "@/lib/vocabulary/resolve";
import type { WorkspaceTreeGroupBy } from "@/components/workspace/workspace-tree";
import { cn } from "@/lib/utils";

/**
 * Studio's Workspace tab — group-by switcher (Folder/Status/Type) plus a
 * Status/Type filter popover, both scoped to this panel: `foldersOnly`
 * detail-mode Workspace has its own Desk-style `DeskFilterBar` and does not
 * share this component.
 */

const GROUP_TABS: { value: WorkspaceTreeGroupBy; label: string; icon: typeof Folder }[] = [
  { value: "folder", label: "Folder", icon: Folder },
  { value: "status", label: "Status", icon: Zap },
  { value: "type", label: "Type", icon: Shapes },
];

// Below this the tab labels collide with the icons before the parent panel
// even hits its own MIN_PANEL_WIDTH — the tabs drop to icon-only rather than
// wrap or truncate. Driven by the toolbar's own measured width (not a media
// query) since the panel that hosts it is independently resizable.
const LABEL_MIN_WIDTH = 270;

export function WorkspaceTreeToolbar({
  groupBy,
  onGroupByChange,
  selectedStatuses,
  onToggleStatus,
  selectedArtifactTypes,
  onToggleArtifactType,
  onClearFilters,
  statusCounts,
  artifactTypeCounts,
}: {
  groupBy: WorkspaceTreeGroupBy;
  onGroupByChange: (groupBy: WorkspaceTreeGroupBy) => void;
  selectedStatuses: ReadonlySet<string>;
  onToggleStatus: (status: string) => void;
  selectedArtifactTypes: ReadonlySet<string>;
  onToggleArtifactType: (artifactType: string) => void;
  onClearFilters: () => void;
  /** File count per key — the whole workspace, not the current filter selection. Missing key reads as 0. */
  statusCounts: Readonly<Record<string, number>>;
  artifactTypeCounts: Readonly<Record<string, number>>;
}) {
  const catalog = useVocabulary();
  const statuses = listVisibleVocabulary(catalog, "status");
  const artifactTypes = listVisibleVocabulary(catalog, "type");
  const activeFilterCount = selectedStatuses.size + selectedArtifactTypes.size;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setShowLabels(entry.contentRect.width >= LABEL_MIN_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="mb-1 flex h-9 shrink-0 items-center gap-0.5 rounded-lg border-[0.5px] border-border bg-muted p-[3px]"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Filter the tree"
            className={cn(
              "relative inline-flex h-full shrink-0 items-center justify-center rounded-md px-2 transition-colors",
              activeFilterCount > 0 ? "bg-sb text-ink shadow-[0_1px_2px_rgba(35,24,15,0.1)]" : "text-ink-4 hover:text-ink",
            )}
          >
            <Filter className="h-[13px] w-[13px]" strokeWidth={1.5} />
            {activeFilterCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-cursor px-[3px] font-mono text-[9px] text-bg">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[220px] p-0">
          <div className="od-scroll max-h-[320px] overflow-y-auto p-[5px]">
            <FilterSection label="Status">
              {statuses.map((item) => (
                <FilterOption
                  key={item.key}
                  selected={selectedStatuses.has(item.key)}
                  onClick={() => onToggleStatus(item.key)}
                  mark={<WritingStatusIcon status={item.key} className="h-[13px] w-[13px]" />}
                  count={statusCounts[item.key] ?? 0}
                >
                  {item.name}
                </FilterOption>
              ))}
            </FilterSection>
            <FilterSection label="Artifact type">
              {artifactTypes.map((item) => (
                <FilterOption
                  key={item.key}
                  selected={selectedArtifactTypes.has(item.key)}
                  onClick={() => onToggleArtifactType(item.key)}
                  mark={<ArtifactTypeIcon artifactType={item.key} />}
                  count={artifactTypeCounts[item.key] ?? 0}
                >
                  {item.name}
                </FilterOption>
              ))}
            </FilterSection>
          </div>
          <div className="flex items-center justify-between gap-2.5 border-t-[0.5px] border-line-soft px-2.5 py-1.5">
            <span className="text-[11px] text-ink-4">
              {activeFilterCount > 0 ? `${activeFilterCount} active` : "No filters"}
            </span>
            <button
              type="button"
              onClick={onClearFilters}
              disabled={activeFilterCount === 0}
              className="text-[11px] font-medium text-ink-4 transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />

      {GROUP_TABS.map((tab) => {
        const active = groupBy === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={active}
            onClick={() => onGroupByChange(tab.value)}
            aria-label={showLabels ? undefined : tab.label}
            className={cn(
              "inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors",
              active ? "bg-sb text-ink shadow-[0_1px_2px_rgba(35,24,15,0.1)]" : "text-ink-4 hover:text-ink",
            )}
          >
            <tab.icon className="h-[13px] w-[13px] shrink-0" strokeWidth={1.5} />
            {showLabels ? <span>{tab.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-[9px] pb-[5px] pt-2.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">
        {label}
      </p>
      {children}
    </div>
  );
}

function FilterOption({
  selected,
  onClick,
  mark,
  count,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  mark?: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex h-[30px] w-full items-center gap-2 rounded-[6px] px-[9px] text-left text-[12px] transition-colors hover:bg-surface-menu-hover",
        selected ? "font-medium text-ink" : "font-normal text-ink-2",
      )}
    >
      <span
        className={cn(
          "inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors",
          selected ? "border-ink bg-ink" : "border-ink-6 bg-sb",
        )}
      >
        <Check className={cn("h-[10px] w-[10px] text-bg", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} />
      </span>
      {mark ? <span className="flex shrink-0 items-center">{mark}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-5">{count}</span>
    </button>
  );
}
