"use client";

import { useMemo } from "react";
import { BookPlus, Loader2, RefreshCw, SpellCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicationSuggestion } from "@/lib/local-db/schema";
import type { LearnedWordEntry } from "@/lib/services/contracts/ai-service";
import type { CorrectionAnalysisRunState, CorrectionAnalysisProgress } from "@/hooks/useManualCorrections";
import { getVisibleCorrectionSuggestions, isSuggestionAcceptDisabled } from "@/lib/editor/suggestion-engine";

/**
 * Suggestion kind → the label and dot colour the prototype renders on every
 * correction card (`Artifact Studio Studio.dc.html`, grammarIssues). The three
 * colours are the ones already tokenized in globals.css; no new hex enters here.
 */
const SUGGESTION_KIND_PRESENTATION: Record<
  PublicationSuggestion["kind"],
  { label: string; dot: string }
> = {
  spelling: { label: "Spelling", dot: "var(--od-suggestion-spelling)" },
  grammar: { label: "Grammar", dot: "var(--od-annotation-highlight)" },
  punctuation: { label: "Punctuation", dot: "var(--od-annotation-highlight)" },
  rewriting: { label: "Style", dot: "var(--od-annotation-ai)" },
};

type CorrectionAnalysisStatus = {
  runState: CorrectionAnalysisRunState;
  progress: CorrectionAnalysisProgress;
};

type CorrectionsPanelProps = {
  suggestions: PublicationSuggestion[];
  markdown: string;
  showCorrections: boolean;
  analysisStatus?: CorrectionAnalysisStatus;
  onAcceptSuggestion: (suggestion: PublicationSuggestion, suggestionIds?: string[]) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  onLearnWord: (suggestion: PublicationSuggestion, suggestionIds?: string[]) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  learnedWords: LearnedWordEntry[];
  learnedWordsLoading: boolean;
  onRemoveLearnedWord: (id: string) => void;
  onAnalyze: () => void;
  onRetryFailed?: () => void;
  onCancel?: () => void;
  onShowCorrectionsChange: (show: boolean) => void;
};

export function CorrectionsPanel({
  suggestions,
  markdown,
  showCorrections,
  analysisStatus,
  onAcceptSuggestion,
  onRejectSuggestion,
  onLearnWord,
  onAcceptAll,
  onRejectAll,
  learnedWords,
  learnedWordsLoading,
  onRemoveLearnedWord,
  onAnalyze,
  onRetryFailed,
  onCancel,
  onShowCorrectionsChange,
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
  const runState = analysisStatus?.runState ?? "idle";
  const progress = analysisStatus?.progress ?? { completedBlocks: 0, totalBlocks: 0 };
  const isRunning = runState === "running";
  const isPartialOrFailed = runState === "partial" || runState === "failed";
  const canRetry = isPartialOrFailed && Boolean(onRetryFailed);

  const analysisButtonLabel = (() => {
    switch (runState) {
      case "running":
        return "Analyzing...";
      case "completed":
        return "Analyze again";
      case "partial":
        return "Retry failed sections";
      case "failed":
        return "Try again";
      case "cancelled":
        return "Analyze now";
      case "idle":
      default:
        return "Analyze now";
    }
  })();

  return (
    <aside
      id="editor-panel-corrections"
      data-section="editor-panel-corrections"
      data-testid="editor-panel-corrections"
      className="EditorPanelCorrections od-scroll h-full w-full overflow-y-auto overflow-x-hidden bg-transparent"
    >
      {/* Stacked, not side by side. The button carries a label as long as the
          heading, and with `whitespace-nowrap` in a 276px column it took the
          whole width and squeezed the text to about four characters a line
          (owner review). */}
      <div className="space-y-3 border-b-[0.5px] border-border px-4 py-3">
        <div className="space-y-2">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-ink">
              Analyze writing and spelling
            </p>
            <p className="text-[11px] text-ink-4">
              Review this document for spelling, grammar, and punctuation.
            </p>
          </div>
          <button
            id="corrections-analyze-button"
            type="button"
            onClick={isRunning ? onCancel : isPartialOrFailed ? onRetryFailed : onAnalyze}
            aria-busy={isRunning}
            aria-describedby="corrections-analysis-status"
            className={cn(
              "inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-[6px] border-[0.5px] px-2.5 text-[11px] font-medium transition-opacity",
              isRunning
                ? "border-border text-ink-3 hover:bg-bg hover:text-ink"
                : "border-ink bg-ink text-bg hover:opacity-90",
            )}
          >
            {isRunning ? (
              <X className="h-3 w-3" strokeWidth={1.7} />
            ) : canRetry ? (
              <RefreshCw className="h-3 w-3" strokeWidth={1.7} />
            ) : (
              /* The glyph the titlebar button used to carry — it reads better
                 on the action itself than as a lone icon (owner review). */
              <SpellCheck className="h-[13px] w-[13px]" strokeWidth={1.6} />
            )}
            <span>{isRunning ? "Cancel" : analysisButtonLabel}</span>
          </button>
        </div>

        <div id="corrections-analysis-status" role="status" aria-live="polite">
          {isRunning && progress.totalBlocks > 0 ? (
            <div className="flex items-center gap-2 text-[11px] text-ink-3">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.7} />
              <span>
                Checking {progress.completedBlocks} of {progress.totalBlocks} sections…
              </span>
            </div>
          ) : null}

          {runState === "completed" ? (
            <p className="text-[11px] text-ink-4">Review complete.</p>
          ) : null}

          {runState === "cancelled" ? (
            <p className="text-[11px] text-ink-4">
              Review stopped. You can start again whenever you’re ready.
            </p>
          ) : null}

          {runState === "partial" ? (
            <p className="text-[11px] text-ink-4">
              Some sections couldn’t be analyzed. Your existing results are safe.
            </p>
          ) : null}

          {runState === "failed" ? (
            <p className="text-[11px] text-ink-4">
              We couldn’t analyze this document. Check your connection and try again.
            </p>
          ) : null}
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
          <ul className="space-y-2">
            {groupedSuggestions.map(({ suggestion, ids, count }) => {
              const isStale = isSuggestionAcceptDisabled(suggestion);
              const kind = SUGGESTION_KIND_PRESENTATION[suggestion.kind];

              return (
                <li
                  key={suggestion.id}
                  className={cn(
                    "rounded-lg border border-border px-3 py-[11px] transition-opacity",
                    isStale && "opacity-50",
                  )}
                >
                  <div className="mb-2 flex items-center gap-[7px]">
                    <span
                      aria-hidden="true"
                      className="h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ background: kind.dot }}
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-4">
                      {kind.label}
                    </span>
                    {count > 1 && (
                      <span className="text-[10px] text-ink-4">×{count}</span>
                    )}
                  </div>

                  <p className="mb-2 min-w-0 text-[13px] leading-[1.5] text-ink-2">
                    <span className="pub-suggestion-pending">{suggestion.original_text}</span>
                    <span aria-hidden className="mx-1.5 text-ink-4">→</span>
                    <span className="font-medium text-ink">{suggestion.replacement_text}</span>
                  </p>

                  {suggestion.reason ? (
                    <p className="mb-2.5 text-[12px] leading-[1.5] text-ink-4">{suggestion.reason}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onAcceptSuggestion(suggestion, ids);
                      }}
                      aria-label={isStale ? "Recalculating…" : "Accept"}
                      title={isStale ? "Recalculating…" : "Accept"}
                      disabled={isStale}
                      className="inline-flex h-7 items-center rounded-[6px] bg-ink px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => { for (const id of ids) onRejectSuggestion(id); }}
                      className="inline-flex h-7 items-center rounded-[6px] border border-border px-3 text-[12px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
                    >
                      Reject
                    </button>
                    {suggestion.kind === "spelling" &&
                    (
                      suggestion.mechanical_type == null ||
                      suggestion.mechanical_type === "spelling" ||
                      suggestion.mechanical_type === "accent"
                    ) ? (
                      <button
                        type="button"
                        onClick={() => {
                          onLearnWord(suggestion, ids);
                        }}
                        title="Add to learned words"
                        className="inline-flex h-7 items-center gap-[5px] whitespace-nowrap rounded-[6px] border border-border px-2.5 text-[12px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
                      >
                        <BookPlus className="h-[13px] w-[13px]" strokeWidth={1.6} />
                        <span>Learn word</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t-[0.5px] border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Learned words</p>
            <p className="text-[11px] text-ink-4">
              Saved across your documents.
            </p>
          </div>
          {learnedWords.length > 0 ? (
            <span className="text-[10px] text-ink-4">{learnedWords.length}</span>
          ) : null}
        </div>

        <div className="mt-2">
          {learnedWordsLoading ? (
            <p className="text-[11px] text-ink-4">Loading learned words…</p>
          ) : learnedWords.length === 0 ? (
            <p className="text-[11px] text-ink-4">No learned words yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {learnedWords.map((item) => (
                <li
                  key={item.id}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-[13px] border border-border pl-2.5 pr-1.5 text-[12px] leading-none text-ink-3"
                >
                  <span className="min-w-0 max-w-[160px] truncate">{item.word}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveLearnedWord(item.id)}
                    aria-label={`Forget ${item.word}`}
                    title="Forget"
                    className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                  >
                    <X className="h-3 w-3" strokeWidth={1.6} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
