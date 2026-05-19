import type {
  PublicationChecklistItem,
  PublicationSuggestion,
  PublicationSuggestionStatus,
} from "@/lib/local-db/schema";

type SuggestionMatch = {
  start: number;
  end: number;
};

type SuggestionApplyResult = {
  markdown: string;
  applied: boolean;
};

type ApplyAllSuggestionsResult = {
  markdown: string;
  appliedIds: string[];
};

type StaleInvalidationResult = {
  suggestions: PublicationSuggestion[];
  keptIds: string[];
  droppedIds: string[];
};

const normalizeSearchValue = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .trim();

const countOccurrencesBefore = (source: string, value: string, endIndex: number) => {
  if (!value) {
    return 0;
  }

  let count = 0;
  let cursor = 0;

  while (cursor <= endIndex) {
    const index = source.indexOf(value, cursor);

    if (index === -1 || index >= endIndex) {
      break;
    }

    count += 1;
    cursor = index + value.length;
  }

  return count;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildLooseContextPattern = (value: string) => {
  const normalized = normalizeSearchValue(value);

  if (!normalized) {
    return null;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  return new RegExp(tokens.map((token) => escapeRegex(token)).join("\\s+"), "i");
};

const findContextAwareMatch = (
  source: string,
  originalText: string,
  contextBefore?: string | null,
  contextAfter?: string | null,
  occurrence?: number | null,
) => {
  const normalizedOriginal = normalizeSearchValue(originalText);

  if (!normalizedOriginal) {
    return null;
  }

  const matches: SuggestionMatch[] = [];
  let cursor = 0;

  while (cursor <= source.length - normalizedOriginal.length) {
    const index = source.indexOf(normalizedOriginal, cursor);

    if (index === -1) {
      break;
    }

    matches.push({ start: index, end: index + normalizedOriginal.length });
    cursor = index + normalizedOriginal.length;
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (typeof occurrence === "number" && occurrence >= 0 && occurrence < matches.length) {
    return matches[occurrence];
  }

  const beforePattern = buildLooseContextPattern(contextBefore ?? "");
  const afterPattern = buildLooseContextPattern(contextAfter ?? "");

  if (!beforePattern && !afterPattern) {
    return matches[0];
  }

  return (
    matches.find((match) => {
      const beforeWindow = source.slice(Math.max(0, match.start - 160), match.start);
      const afterWindow = source.slice(match.end, Math.min(source.length, match.end + 160));

      if (beforePattern && !beforePattern.test(beforeWindow)) {
        return false;
      }

      if (afterPattern && !afterPattern.test(afterWindow)) {
        return false;
      }

      return true;
    }) ?? matches[0]
  );
};

export const hashPublicationSource = (source: string) => {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `pub-${(hash >>> 0).toString(16)}`;
};

export const createPublicationReviewId = (writingId: string, sourceHash: string) =>
  `publication-review:${writingId}:${sourceHash}`;

export const findSuggestionMatch = (source: string, suggestion: PublicationSuggestion) =>
  findContextAwareMatch(
    source,
    suggestion.original_text,
    suggestion.context_before,
    suggestion.context_after,
    suggestion.occurrence,
  );

export const applySuggestionToMarkdown = (
  source: string,
  suggestion: PublicationSuggestion,
): SuggestionApplyResult => {
  const match = findSuggestionMatch(source, suggestion);

  if (!match) {
    return { markdown: source, applied: false };
  }

  return {
    markdown: `${source.slice(0, match.start)}${suggestion.replacement_text}${source.slice(match.end)}`,
    applied: true,
  };
};

export const applyAllPublicationSuggestions = (
  source: string,
  suggestions: PublicationSuggestion[],
): ApplyAllSuggestionsResult => {
  const applicableSuggestions = suggestions
    .filter((suggestion) => suggestion.status === "pending")
    .map((suggestion) => {
      const match = findSuggestionMatch(source, suggestion);
      return match ? { suggestion, match } : null;
    })
    .filter((value): value is { suggestion: PublicationSuggestion; match: SuggestionMatch } => value !== null)
    .sort((left, right) => right.match.start - left.match.start);

  if (applicableSuggestions.length === 0) {
    return { markdown: source, appliedIds: [] };
  }

  let nextMarkdown = source;
  const appliedIds: string[] = [];

  for (const { suggestion, match } of applicableSuggestions) {
    nextMarkdown = `${nextMarkdown.slice(0, match.start)}${suggestion.replacement_text}${nextMarkdown.slice(match.end)}`;
    appliedIds.push(suggestion.id);
  }

  return { markdown: nextMarkdown, appliedIds };
};

export const invalidateBlockSuggestions = (
  suggestions: PublicationSuggestion[],
  block: { id: string; text: string },
): StaleInvalidationResult => {
  const keptIds: string[] = [];
  const droppedIds: string[] = [];

  const nextSuggestions = suggestions.flatMap((suggestion) => {
    if (suggestion.block_id !== block.id) {
      return [suggestion];
    }

    if (
      (suggestion.status === "pending" || suggestion.status === "pending-stale") &&
      block.text.includes(suggestion.original_text)
    ) {
      keptIds.push(suggestion.id);
      return [{ ...suggestion, status: "pending-stale" as const }];
    }

    droppedIds.push(suggestion.id);
    return [];
  });

  return {
    suggestions: nextSuggestions,
    keptIds,
    droppedIds,
  };
};

export const isSuggestionAcceptDisabled = (suggestion: PublicationSuggestion) =>
  suggestion.status === "pending-stale";

export const updateSuggestionStatuses = (
  suggestions: PublicationSuggestion[],
  ids: string[],
  status: PublicationSuggestionStatus,
) => {
  const nextIds = new Set(ids);

  return suggestions.map((suggestion) =>
    nextIds.has(suggestion.id)
      ? {
          ...suggestion,
          status,
        }
      : suggestion,
  );
};

export const markChecklistDone = (checklist: PublicationChecklistItem[], checklistId: string) =>
  checklist.map((item) =>
    item.id === checklistId
      ? {
          ...item,
          status: "done",
        }
      : item,
  );

export const deriveSuggestionContexts = (source: string, originalText: string, preferredStartIndex?: number | null) => {
  const normalizedOriginal = normalizeSearchValue(originalText);

  if (!normalizedOriginal) {
    return {
      context_before: null,
      context_after: null,
      occurrence: 0,
    };
  }

  const firstIndex =
    typeof preferredStartIndex === "number" && preferredStartIndex >= 0
      ? preferredStartIndex
      : source.indexOf(normalizedOriginal);

  if (firstIndex === -1 || source.slice(firstIndex, firstIndex + normalizedOriginal.length) !== normalizedOriginal) {
    return {
      context_before: null,
      context_after: null,
      occurrence: 0,
    };
  }

  const contextBefore = source
    .slice(Math.max(0, firstIndex - 80), firstIndex)
    .trim()
    .slice(-40);
  const contextAfter = source
    .slice(firstIndex + normalizedOriginal.length, firstIndex + normalizedOriginal.length + 80)
    .trim()
    .slice(0, 40);

  return {
    context_before: contextBefore || null,
    context_after: contextAfter || null,
    occurrence: countOccurrencesBefore(source, normalizedOriginal, firstIndex),
  };
};

export const findChecklistMatch = (source: string, item: PublicationChecklistItem) => {
  if (!item.target_text) {
    return null;
  }

  return findContextAwareMatch(source, item.target_text, null, null);
};
