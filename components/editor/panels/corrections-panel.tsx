"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicationSuggestion } from "@/lib/local-db/schema";
import { getVisibleCorrectionSuggestions, isSuggestionAcceptDisabled } from "@/lib/editor/suggestion-engine";

type CorrectionsPanelProps = {
  suggestions: PublicationSuggestion[];
  markdown: string;
  correctionsEnabled: boolean;
  showCorrections: boolean;
  onAcceptSuggestion: (suggestion: PublicationSuggestion) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onCorrectionsEnabledChange: (enabled: boolean) => void;
  onShowCorrectionsChange: (show: boolean) => void;
  onClose: () => void;
};

export function CorrectionsPanel({
  suggestions,
  markdown,
  correctionsEnabled,
  showCorrections,
  onAcceptSuggestion,
  onRejectSuggestion,
  onAcceptAll,
  onRejectAll,
  onCorrectionsEnabledChange,
  onShowCorrectionsChange,
  onClose,
}: CorrectionsPanelProps) {
  const visibleSuggestions = useMemo(
    () => getVisibleCorrectionSuggestions(suggestions, markdown),
    [suggestions, markdown],
  );

  const groupedSuggestions = useMemo(() => {
    const groups = new Map<string, { suggestion: PublicationSuggestion; ids: string[]; count: number }>();
    for (const suggestion of visibleSuggestions) {
      const key = `${suggestion.original_text.trim()}→${suggestion.replacement_text.trim()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.ids.push(suggestion.id);
        existing.count += 1;
      } else {
        groups.set(key, { suggestion, ids: [suggestion.id], count: 1 });
      }
    }
    return [...groups.values()];
  }, [visibleSuggestions]);

  const actionableSuggestions = visibleSuggestions.filter((suggestion) => suggestion.status === "pending");
  const hasPending = visibleSuggestions.length > 0;

  return (
    <aside
      id="editor-panel-corrections"
      data-section="editor-panel-corrections"
      data-testid="editor-panel-corrections"
      className="fixed right-0 top-[56px] bottom-8 z-40 w-[312px] min-w-[312px] max-w-[312px] overflow-y-auto border-l-[0.5px] border-border bg-sb"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Corrections</p>
          {hasPending ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(22,55%,92%)] px-1.5 text-[10px] font-medium text-cursor">
              {visibleSuggestions.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close corrections panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-3 border-b-[0.5px] border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <label
              htmlFor="corrections-enabled-switch"
              className="block text-[12px] font-medium text-ink"
            >
              Active corrections
            </label>
            <p className="text-[11px] text-ink-4">Analyzes new blocks automatically.</p>
          </div>
          <button
            id="corrections-enabled-switch"
            type="button"
            role="switch"
            aria-checked={correctionsEnabled}
            aria-label="Enable automatic corrections"
            onClick={() => onCorrectionsEnabledChange(!correctionsEnabled)}
            className={cn(
              "relative h-[18px] w-8 shrink-0 rounded-[9px] border-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              correctionsEnabled ? "bg-ink" : "bg-border",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform",
                correctionsEnabled ? "translate-x-[14px]" : "translate-x-0",
              )}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <label
              htmlFor="corrections-visible-switch"
              className="block text-[12px] font-medium text-ink"
            >
              Show corrections
            </label>
            <p className="text-[11px] text-ink-4">Shows inline marks within the document.</p>
          </div>
          <button
            id="corrections-visible-switch"
            type="button"
            role="switch"
            aria-checked={showCorrections}
            aria-label="Show corrections in the document"
            onClick={() => onShowCorrectionsChange(!showCorrections)}
            className={cn(
              "relative h-[18px] w-8 shrink-0 rounded-[9px] border-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              showCorrections ? "bg-ink" : "bg-border",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform",
                showCorrections ? "translate-x-[14px]" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </div>

      {actionableSuggestions.length > 0 ? (
        <div className="flex items-center justify-end gap-3 border-b-[0.5px] border-border px-4 py-2">
          <button
            type="button"
            onClick={() => onAcceptAll()}
            className="text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            Accept all
          </button>
          <span className="text-[11px] text-ink-4">·</span>
          <button
            type="button"
            onClick={() => onRejectAll()}
            className="text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            Reject all
          </button>
        </div>
      ) : null}

      <div className="p-2">
        {visibleSuggestions.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-ink-4">
            No pending corrections.
          </p>
        ) : (
          <ul className="space-y-px">
            {groupedSuggestions.map(({ suggestion, ids, count }) => {
              const isStale = isSuggestionAcceptDisabled(suggestion);

              return (
                <li
                  key={suggestion.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted ${
                    isStale ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[12px] leading-tight">
                    <span className="truncate text-ink-4 line-through decoration-ink-4 decoration-[0.5px]">
                      {suggestion.original_text}
                    </span>
                    <span aria-hidden className="shrink-0 text-ink-4">→</span>
                    <span className="truncate text-ink">
                      {suggestion.replacement_text}
                    </span>
                    {count > 1 && (
                      <span className="shrink-0 text-[10px] text-ink-4">×{count}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        for (const id of ids) onRejectSuggestion(id);
                        onAcceptSuggestion(suggestion);
                      }}
                      aria-label={isStale ? "Recalculating…" : "Accept"}
                      title={isStale ? "Recalculating…" : "Accept"}
                      disabled={isStale}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-bg hover:text-ink"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { for (const id of ids) onRejectSuggestion(id); }}
                      aria-label="Reject"
                      title="Reject"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-bg hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
