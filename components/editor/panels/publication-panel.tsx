"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCcw, Sparkles, Wand2, X } from "lucide-react";
import { localDB } from "@/lib/local-db";
import type { LocalPublicationReview, PublicationChecklistItem, PublicationSuggestion } from "@/lib/local-db/schema";
import {
  applyAllPublicationSuggestions,
  applySuggestionToMarkdown,
  createPublicationReviewId,
  hashPublicationSource,
  updateSuggestionStatuses,
} from "@/lib/editor/suggestion-engine";
import { createPublicationReviewLookupKey } from "@/lib/local-db";
import { cn } from "@/lib/utils";

type PublicationPanelProps = {
  writingId: string | null;
  title: string;
  markdown: string;
  bodyText: string;
  onApplyMarkdown: (nextMarkdown: string) => void;
  onJumpToText: (targetText: string) => void;
  onClose: () => void;
  onSuggestionsChange?: (suggestions: PublicationSuggestion[]) => void;
};

type ApiEnvelope<TData> = {
  data: TData | null;
  error: {
    code: string;
    message: string;
  } | null;
};

type PublicationReviewApiResponse = {
  sourceHash: string;
  sourceMarkdown: string;
  model: string;
  suggestions: PublicationSuggestion[];
  checklist: PublicationChecklistItem[];
  summary?: string | null;
  fallbackUsed: boolean;
};

export function PublicationPanel({
  writingId,
  title,
  markdown,
  bodyText,
  onApplyMarkdown,
  onJumpToText,
  onClose,
  onSuggestionsChange,
}: PublicationPanelProps) {
  const currentHash = useMemo(() => hashPublicationSource(markdown), [markdown]);
  const [review, setReview] = useState<LocalPublicationReview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestInFlightRef = useRef(false);
  const reviewRef = useRef<LocalPublicationReview | null>(null);

  const persistReview = useCallback(async (nextReview: LocalPublicationReview) => {
    await localDB.publicationReviews.save(nextReview);
    reviewRef.current = nextReview;
    setReview(nextReview);
  }, []);

  const runAnalysis = useCallback(
    async (mode: "auto" | "manual") => {
      if (!writingId || requestInFlightRef.current) {
        return;
      }

      requestInFlightRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/ai/publication-review", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            writingId,
            title,
            markdown,
            bodyText,
            sourceHash: currentHash,
          }),
        });

        const payload = (await response.json()) as ApiEnvelope<PublicationReviewApiResponse>;

        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? "Publication review failed.");
        }

        const nowIso = new Date().toISOString();
        const nextReview: LocalPublicationReview = {
          id: createPublicationReviewId(writingId, payload.data.sourceHash),
          writing_id: writingId,
          source_hash: payload.data.sourceHash,
          source_markdown: payload.data.sourceMarkdown,
          title,
          model: payload.data.model,
          suggestions: payload.data.suggestions,
          checklist: payload.data.checklist,
          summary: payload.data.summary ?? null,
          created_at: nowIso,
          updated_at: nowIso,
          lookup_key: createPublicationReviewLookupKey(writingId, payload.data.sourceHash),
          last_error: null,
        };

        await persistReview(nextReview);
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Publication review failed.";
        setError(message);

        if (mode === "manual" && reviewRef.current) {
          await persistReview({
            ...reviewRef.current,
            updated_at: new Date().toISOString(),
            last_error: message,
          });
        }
      } finally {
        requestInFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [bodyText, currentHash, markdown, persistReview, title, writingId],
  );

  useEffect(() => {
    if (!writingId) {
      setReview(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadCachedReview = async () => {
      const cachedReview = await localDB.publicationReviews.getByWritingAndHash(writingId, currentHash);

      if (cancelled) {
        return;
      }

      if (cachedReview) {
        reviewRef.current = cachedReview;
        setReview(cachedReview);
        setError(cachedReview.last_error ?? null);
        return;
      }

      // Si ya hay un review en pantalla, mostrarlo como stale — el usuario está aplicando sugerencias.
      // No descartar, no re-analizar automáticamente.
      if (reviewRef.current !== null) {
        return;
      }

      setReview(null);
      setError(null);

      debounceRef.current = window.setTimeout(() => {
        void runAnalysis("auto");
      }, 2000);
    };

    void loadCachedReview();

    return () => {
      cancelled = true;

      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [currentHash, runAnalysis, writingId]);

  const hasPendingSuggestions = review?.suggestions.some((suggestion) => suggestion.status === "pending") ?? false;
  const isStale = review ? review.source_hash !== currentHash : false;
  const spellingSuggestions = review?.suggestions.filter((suggestion) => suggestion.kind === "spelling") ?? [];
  const rewritingSuggestions = review?.suggestions.filter((suggestion) => suggestion.kind === "rewriting") ?? [];

  useEffect(() => {
    onSuggestionsChange?.(review?.suggestions ?? [])
  }, [review, onSuggestionsChange])

  useEffect(() => {
    return () => {
      onSuggestionsChange?.([])
    }
  }, [onSuggestionsChange])

  const updateReview = useCallback(
    async (updater: (current: LocalPublicationReview) => LocalPublicationReview) => {
      if (!review) {
        return;
      }

      const nextReview = updater(review);
      await persistReview(nextReview);
    },
    [persistReview, review],
  );

  const handleApplySuggestion = useCallback(
    async (suggestion: PublicationSuggestion) => {
      const result = applySuggestionToMarkdown(markdown, suggestion);

      if (!result.applied) {
        await updateReview((current) => ({
          ...current,
          suggestions: updateSuggestionStatuses(current.suggestions, [suggestion.id], "conflict"),
          updated_at: new Date().toISOString(),
        }));
        return;
      }

      onApplyMarkdown(result.markdown);
      await updateReview((current) => ({
        ...current,
        suggestions: updateSuggestionStatuses(current.suggestions, [suggestion.id], "accepted"),
        updated_at: new Date().toISOString(),
      }));
    },
    [markdown, onApplyMarkdown, updateReview],
  );

  const handleRejectSuggestion = useCallback(
    async (suggestionId: string) => {
      await updateReview((current) => ({
        ...current,
        suggestions: updateSuggestionStatuses(current.suggestions, [suggestionId], "rejected"),
        updated_at: new Date().toISOString(),
      }));
    },
    [updateReview],
  );

  const handleApplyAll = useCallback(async () => {
    if (!review) {
      return;
    }

    const result = applyAllPublicationSuggestions(markdown, review.suggestions);

    if (result.appliedIds.length === 0) {
      return;
    }

    onApplyMarkdown(result.markdown);
    await updateReview((current) => ({
      ...current,
      suggestions: updateSuggestionStatuses(current.suggestions, result.appliedIds, "accepted"),
      updated_at: new Date().toISOString(),
    }));
  }, [markdown, onApplyMarkdown, review, updateReview]);

  return (
    <aside
      id="editor-panel-publication"
      data-section="editor-panel-publication"
      data-testid="editor-panel-publication"
      className="fixed right-0 top-[56px] bottom-8 z-40 w-[312px] overflow-y-auto border-l-[0.5px] border-border bg-sb"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-[13px] w-[13px] text-cursor" strokeWidth={1.5} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Ready to publish</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close publication panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <section className="rounded-[12px] border-[0.5px] border-border bg-[hsl(22,55%,97%)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-lora text-[17px] leading-tight text-ink">Publication review</p>
              <p className="text-[11px] leading-relaxed text-ink-3">
                Review spelling, tighten phrasing, and verify a final publication checklist without mutating the writing
                until you confirm each change.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runAnalysis("manual")}
              disabled={isLoading || !writingId}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border-[0.5px] border-border bg-bg px-2.5 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
              Reanalyze
            </button>
          </div>

          {review?.summary ? <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{review.summary}</p> : null}
          {isStale ? (
            <p className="mt-2 rounded-md border-[0.5px] border-[hsl(22,40%,84%)] bg-bg px-2 py-1.5 text-[11px] text-ink-3">
              Suggestions are based on a previous version of this text. Reanalyze to refresh them.
            </p>
          ) : null}
          {error ? <p className="mt-2 text-[11px] text-[hsl(0,72%,45%)]">{error}</p> : null}
        </section>

        {isLoading ? (
          <section className="rounded-[12px] border-[0.5px] border-border bg-bg p-4">
            <div className="flex items-center gap-3 text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin text-cursor" strokeWidth={1.5} />
              <div>
                <p className="text-[12px] font-medium text-ink">Analyzing text...</p>
                <p className="text-[11px] text-ink-4">Preparing spelling, redaction, and publication checks.</p>
              </div>
            </div>
          </section>
        ) : null}

        <SectionHeader
          title="Spelling & Grammar"
          actionLabel={hasPendingSuggestions ? "Apply all" : undefined}
          onAction={hasPendingSuggestions ? () => void handleApplyAll() : undefined}
        />
        <SuggestionList
          emptyLabel="No spelling corrections suggested."
          suggestions={spellingSuggestions}
          onAccept={(suggestion) => void handleApplySuggestion(suggestion)}
          onReject={(suggestionId) => void handleRejectSuggestion(suggestionId)}
        />

        <SectionHeader title="Redaction" />
        <SuggestionList
          emptyLabel="No phrasing improvements suggested."
          suggestions={rewritingSuggestions}
          onAccept={(suggestion) => void handleApplySuggestion(suggestion)}
          onReject={(suggestionId) => void handleRejectSuggestion(suggestionId)}
        />

        <SectionHeader title="Checklist" />
        <ChecklistList checklist={review?.checklist ?? []} onJumpToText={onJumpToText} />
      </div>
    </aside>
  );
}

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">{title}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="text-[11px] font-medium text-cursor transition-opacity hover:opacity-80"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

type SuggestionListProps = {
  suggestions: PublicationSuggestion[];
  emptyLabel: string;
  onAccept: (suggestion: PublicationSuggestion) => void;
  onReject: (suggestionId: string) => void;
};

function SuggestionList({ suggestions, emptyLabel, onAccept, onReject }: SuggestionListProps) {
  if (suggestions.length === 0) {
    return <p className="rounded-[12px] border-[0.5px] border-dashed border-border px-3 py-4 text-[11px] text-ink-4">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2.5">
      {suggestions.map((suggestion) => (
        <article key={suggestion.id} className="rounded-[12px] border-[0.5px] border-border bg-bg p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-ink">{suggestion.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{suggestion.reason}</p>
            </div>
            <SuggestionStatusBadge status={suggestion.status} />
          </div>

          <div className="mt-3 space-y-2 rounded-md border-[0.5px] border-border bg-sb p-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.07em] text-ink-4">Original</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3 line-through decoration-[1.2px]">{suggestion.original_text}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.07em] text-ink-4">Suggested</p>
              <p className="mt-1 rounded-sm bg-[hsl(22,55%,94%)] px-1.5 py-1 text-[12px] leading-relaxed text-ink">{suggestion.replacement_text}</p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onAccept(suggestion)}
              disabled={suggestion.status !== "pending"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border-[0.5px] border-ink bg-ink px-3 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              Accept
            </button>
            <button
              type="button"
              onClick={() => onReject(suggestion.id)}
              disabled={suggestion.status !== "pending"}
              className="inline-flex h-8 items-center rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function SuggestionStatusBadge({ status }: { status: PublicationSuggestion["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[10px] font-medium uppercase tracking-[0.07em]",
        status === "accepted" && "bg-[hsl(140,30%,91%)] text-[hsl(140,40%,30%)]",
        status === "rejected" && "bg-muted text-ink-4",
        status === "conflict" && "bg-[hsl(0,72%,95%)] text-[hsl(0,72%,40%)]",
        status === "pending" && "bg-[hsl(22,55%,92%)] text-cursor",
      )}
    >
      {status}
    </span>
  );
}

function ChecklistList({
  checklist,
  onJumpToText,
}: {
  checklist: PublicationChecklistItem[];
  onJumpToText: (targetText: string) => void;
}) {
  if (checklist.length === 0) {
    return <p className="rounded-[12px] border-[0.5px] border-dashed border-border px-3 py-4 text-[11px] text-ink-4">No checklist items suggested.</p>;
  }

  return (
    <div className="space-y-2.5">
      {checklist.map((item) => (
        <article key={item.id} className="rounded-[12px] border-[0.5px] border-border bg-bg p-3">
          <div className="flex items-start gap-2">
            <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cursor" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink">{item.label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{item.detail}</p>
            </div>
          </div>

          {item.target_text ? (
            <button
              type="button"
              onClick={() => onJumpToText(item.target_text ?? "")}
              className="mt-3 inline-flex h-8 items-center rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink"
            >
              Jump to location
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
