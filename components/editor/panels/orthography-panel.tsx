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

      {hasPending ? (
        <div className="flex items-center justify-end gap-3 border-b-[0.5px] border-border px-4 py-2">
          <button
            type="button"
            onClick={() => onAcceptAll()}
            className="text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            Aceptar todos
          </button>
          <span className="text-[11px] text-ink-4">·</span>
          <button
            type="button"
            onClick={() => onRejectAll()}
            className="text-[11px] text-ink-3 transition-colors hover:text-ink"
          >
            Rechazar todos
          </button>
        </div>
      ) : null}

      <div className="p-2">
        {pendingSuggestions.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-ink-4">
            No hay correcciones pendientes.
          </p>
        ) : (
          <ul className="space-y-px">
            {pendingSuggestions.map((suggestion) => (
              <li
                key={suggestion.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
              >
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[12px] leading-tight">
                  <span className="truncate text-ink-4 line-through decoration-ink-4 decoration-[0.5px]">
                    {suggestion.original_text}
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-4">→</span>
                  <span className="truncate text-ink">
                    {suggestion.replacement_text}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onAcceptSuggestion(suggestion)}
                    aria-label="Aceptar"
                    title="Aceptar"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-bg hover:text-ink"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectSuggestion(suggestion.id)}
                    aria-label="Rechazar"
                    title="Rechazar"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-bg hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
