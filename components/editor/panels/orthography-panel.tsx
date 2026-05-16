"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import type { PublicationSuggestion } from "@/lib/local-db/schema";
import { findSuggestionMatch } from "@/lib/editor/suggestion-engine";

type OrthographyPanelProps = {
  suggestions: PublicationSuggestion[];
  markdown: string;
  onAcceptSuggestion: (suggestion: PublicationSuggestion) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
};

const kindLabel = (kind: PublicationSuggestion["kind"]): string => {
  switch (kind) {
    case "spelling":
      return "Ortografía";
    case "rewriting":
      return "Redacción";
    default:
      return "Corrección";
  }
};

export function OrthographyPanel({
  suggestions,
  markdown,
  onAcceptSuggestion,
  onRejectSuggestion,
  onAcceptAll,
  onRejectAll,
  onClose,
}: OrthographyPanelProps) {
  const pendingSuggestions = useMemo(() => {
    const pending = suggestions.filter(
      (suggestion) => suggestion.status === "pending" && suggestion.kind === "spelling",
    );

    return pending
      .map((suggestion) => {
        const match = findSuggestionMatch(markdown, suggestion);
        return { suggestion, position: match?.start ?? Number.MAX_SAFE_INTEGER };
      })
      .sort((left, right) => left.position - right.position)
      .map(({ suggestion }) => suggestion);
  }, [suggestions, markdown]);

  const hasPending = pendingSuggestions.length > 0;

  return (
    <aside
      id="editor-panel-orthography"
      data-section="editor-panel-orthography"
      data-testid="editor-panel-orthography"
      className="fixed right-0 top-[46px] bottom-8 z-40 w-[312px] overflow-y-auto border-l-[0.5px] border-border bg-sb"
    >
      <div className="flex h-[46px] items-center justify-between border-b-[0.5px] border-border px-4">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">Ortografía</p>
          {hasPending ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(22,55%,92%)] px-1.5 text-[10px] font-medium text-cursor">
              {pendingSuggestions.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Close orthography panel"
        >
          <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {hasPending ? (
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-ink-3">
              {pendingSuggestions.length} corrección{pendingSuggestions.length === 1 ? "" : "es"} pendiente
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onAcceptAll()}
                className="text-[11px] font-medium text-cursor transition-opacity hover:opacity-80"
              >
                Aceptar todos
              </button>
              <span className="text-[11px] text-ink-4">·</span>
              <button
                type="button"
                onClick={() => onRejectAll()}
                className="text-[11px] font-medium text-ink-3 transition-opacity hover:opacity-80"
              >
                Rechazar todos
              </button>
            </div>
          </div>
        ) : null}

        {pendingSuggestions.length === 0 ? (
          <p className="rounded-[12px] border-[0.5px] border-dashed border-border px-3 py-4 text-[11px] text-ink-4">
            No hay correcciones pendientes.
          </p>
        ) : (
          <div className="space-y-3">
            {pendingSuggestions.map((suggestion) => (
              <article
                key={suggestion.id}
                className="rounded-[12px] border-[0.5px] border-border bg-bg p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[12px] font-medium text-ink">{suggestion.title}</p>
                      <span className="shrink-0 rounded-full bg-[hsl(22,55%,92%)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.07em] text-cursor">
                        {kindLabel(suggestion.kind)}
                      </span>
                    </div>
                    {suggestion.reason ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{suggestion.reason}</p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 space-y-2 rounded-md border-[0.5px] border-border bg-sb p-2.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.07em] text-ink-4">Original</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-3 line-through decoration-[1.2px]">
                      {suggestion.original_text}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.07em] text-ink-4">Sugerencia</p>
                    <p className="mt-1 rounded-sm bg-[hsl(22,55%,94%)] px-1.5 py-1 text-[12px] leading-relaxed text-ink">
                      {suggestion.replacement_text}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onAcceptSuggestion(suggestion)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border-[0.5px] border-ink bg-ink px-3 text-[11px] font-medium text-bg transition-opacity hover:opacity-90"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Aceptar
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectSuggestion(suggestion.id)}
                    className="inline-flex h-8 items-center rounded-md border-[0.5px] border-border bg-bg px-3 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink"
                  >
                    Rechazar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
