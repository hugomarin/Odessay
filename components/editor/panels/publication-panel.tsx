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
import type { MechanicalCorrectionsContract } from "@/lib/ai/corrections-contract-adapter";
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
  language?: "es" | "en" | "mixed" | "unknown";
  contractVersion?: "mechanical-corrections-v1";
  canonicalReview?: MechanicalCorrectionsContract;
  suggestions: PublicationSuggestion[];
  checklist: PublicationChecklistItem[];
  summary?: string | null;
  fallbackUsed: boolean;
};

type CorrectionMemoryEntry = {
  fingerprint: string;
  decision: "accepted" | "rejected";
  decidedAt: string;
};

type StreamEvent =
  | {
      type: "meta";
      sourceHash: string;
      sourceMarkdown: string;
      model: string;
      language: "es" | "en" | "mixed" | "unknown";
      summary: string;
    }
  | {
      type: "suggestion";
      sourceHash: string;
      blockId: string | null;
      blockHash: string | null;
      suggestion: PublicationSuggestion;
      index: number;
    }
  | {
      type: "uncertain";
      sourceHash: string;
      item: PublicationChecklistItem;
      index: number;
    }
  | {
      type: "done";
      data: PublicationReviewApiResponse;
    };

const CORRECTION_MEMORY_STORAGE_KEY = "odessay-correction-memory";

const hashCorrectionBlockClient = (text: string) => {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `blk-${(hash >>> 0).toString(16)}`;
};

const buildClientCorrectionBlockHashes = (text: string) => {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const sourceBlocks = blocks.length > 0 ? blocks : [text.trim()].filter(Boolean);

  return new Map(sourceBlocks.map((block, index) => [`block-${index + 1}`, hashCorrectionBlockClient(block)]));
};

const readCorrectionMemory = (): CorrectionMemoryEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const value = window.localStorage.getItem(CORRECTION_MEMORY_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const rememberCorrectionDecision = (fingerprint: string | null | undefined, decision: "accepted" | "rejected") => {
  if (!fingerprint || typeof window === "undefined") {
    return;
  }

  const entries = readCorrectionMemory().filter((entry) => entry.fingerprint !== fingerprint);
  entries.push({
    fingerprint,
    decision,
    decidedAt: new Date().toISOString(),
  });

  window.localStorage.setItem(CORRECTION_MEMORY_STORAGE_KEY, JSON.stringify(entries.slice(-200)));
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentHashRef = useRef(currentHash);
  const reviewRef = useRef<LocalPublicationReview | null>(null);

  useEffect(() => {
    currentHashRef.current = currentHash;
  }, [currentHash]);

  const persistReview = useCallback(async (nextReview: LocalPublicationReview) => {
    await localDB.publicationReviews.save(nextReview);
    reviewRef.current = nextReview;
    setReview(nextReview);
  }, []);

  const runAnalysis = useCallback(
    async (mode: "auto" | "manual") => {
      if (!writingId) {
        return;
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      requestInFlightRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const requestSourceHash = currentHash;
        const nowIso = new Date().toISOString();
        const blockHashById = buildClientCorrectionBlockHashes(bodyText.trim() || markdown);
        const streamingReview: LocalPublicationReview = {
          id: createPublicationReviewId(writingId, requestSourceHash),
          writing_id: writingId,
          source_hash: requestSourceHash,
          source_markdown: markdown,
          title,
          model: "",
          suggestions: [],
          checklist: [],
          summary: null,
          created_at: nowIso,
          updated_at: nowIso,
          lookup_key: createPublicationReviewLookupKey(writingId, requestSourceHash),
          last_error: null,
        };

        const response = await fetch("/api/ai/publication-review", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/x-ndjson",
          },
          signal: abortController.signal,
          body: JSON.stringify({
            writingId,
            title,
            markdown,
            bodyText,
            sourceHash: requestSourceHash,
            stream: true,
            correctionMemory: {
              entries: readCorrectionMemory(),
            },
          }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as ApiEnvelope<PublicationReviewApiResponse>;
          throw new Error(payload.error?.message ?? "Publication review failed.");
        }

        if (!response.body) {
          throw new Error("Publication review stream failed.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let nextReview = streamingReview;

        const commitReview = async (candidate: LocalPublicationReview) => {
          if (currentHashRef.current !== requestSourceHash || abortController.signal.aborted) {
            return;
          }

          nextReview = {
            ...candidate,
            updated_at: new Date().toISOString(),
          };
          await persistReview(nextReview);
        };

        const handleStreamEvent = async (event: StreamEvent) => {
          if (event.type !== "done" && event.sourceHash !== requestSourceHash) {
            return;
          }

          if (event.type === "meta") {
            await commitReview({
              ...nextReview,
              model: event.model,
              summary: event.summary || null,
            });
            return;
          }

          if (event.type === "suggestion") {
            const currentBlockHash = event.blockId ? blockHashById.get(event.blockId) ?? null : null;

            if (event.blockHash && currentBlockHash !== event.blockHash) {
              return;
            }

            await commitReview({
              ...nextReview,
              suggestions: [...nextReview.suggestions, event.suggestion],
            });
            return;
          }

          if (event.type === "uncertain") {
            await commitReview({
              ...nextReview,
              checklist: [...nextReview.checklist, event.item],
            });
            return;
          }

          if (event.type === "done") {
            if (event.data.sourceHash !== requestSourceHash) {
              return;
            }

            await commitReview({
              ...nextReview,
              model: event.data.model,
              suggestions: event.data.suggestions,
              checklist: event.data.checklist,
              summary: event.data.summary ?? null,
            });
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }

            await handleStreamEvent(JSON.parse(line) as StreamEvent);
          }

          if (done) {
            break;
          }
        }

        if (buffer.trim()) {
          await handleStreamEvent(JSON.parse(buffer) as StreamEvent);
        }
      } catch (nextError) {
        if (nextError instanceof DOMException && nextError.name === "AbortError") {
          return;
        }

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
        if (abortControllerRef.current === abortController) {
          requestInFlightRef.current = false;
          abortControllerRef.current = null;
          setIsLoading(false);
        }
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

      setError(null);

      const boundaryDelay = /(?:[.!?。！？]\s*|\n{2,})$/.test(markdown) ? 350 : 1400;
      debounceRef.current = window.setTimeout(() => {
        void runAnalysis("auto");
      }, boundaryDelay);
    };

    void loadCachedReview();

    return () => {
      cancelled = true;

      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [currentHash, markdown, runAnalysis, writingId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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
      rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted");
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
      const suggestion = review?.suggestions.find((item) => item.id === suggestionId);
      rememberCorrectionDecision(suggestion?.correction_fingerprint, "rejected");
      await updateReview((current) => ({
        ...current,
        suggestions: updateSuggestionStatuses(current.suggestions, [suggestionId], "rejected"),
        updated_at: new Date().toISOString(),
      }));
    },
    [review?.suggestions, updateReview],
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
    review.suggestions
      .filter((suggestion) => result.appliedIds.includes(suggestion.id))
      .forEach((suggestion) => rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted"));
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
      className="fixed right-0 top-[46px] bottom-8 z-40 w-[312px] overflow-y-auto border-l-[0.5px] border-border bg-sb"
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
