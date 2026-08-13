import type {
  PublicationChecklistItem,
  PublicationSuggestion,
  PublicationSuggestionStatus,
} from "@/lib/local-db/schema";
import {
  parseCorrectionBlockLogicalId,
  parseCorrectionBlockPosition,
} from "@/lib/corrections/block-invalidation";
import { markSuggestionStale } from "@/lib/corrections/engine/lifecycle";
import {
  countTokenBoundaryMatchesBefore,
  findTokenBoundaryMatch,
  type TokenMatch,
} from "@/lib/corrections/engine/matching";

type SuggestionMatch = TokenMatch;

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

type BlockSuggestionReplacementResult = {
  suggestions: PublicationSuggestion[];
  replacedIds: string[];
};

export type SuggestionGroupApplyResult = {
  markdown: string;
  appliedIds: string[];
  conflictIds: string[];
};

type SortedSuggestion = {
  suggestion: PublicationSuggestion;
  position: number;
};

const normalizeSearchValue = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .trim();

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
  findTokenBoundaryMatch(
    source,
    suggestion.original_text,
    suggestion.replacement_text,
    suggestion.context_before,
    suggestion.context_after,
    suggestion.occurrence,
  );

export const getVisibleCorrectionSuggestions = (
  suggestions: PublicationSuggestion[],
  markdown: string,
) =>
  suggestions
    .filter(
      (suggestion) =>
        suggestion.status === "pending" || suggestion.status === "pending-stale",
    )
    .map((suggestion): SortedSuggestion & { matched: boolean } => {
      const match = findSuggestionMatch(markdown, suggestion);
      return { suggestion, position: match?.start ?? Number.MAX_SAFE_INTEGER, matched: match !== null };
    })
    .sort((left, right) => {
      if (left.matched !== right.matched) {
        return left.matched ? -1 : 1;
      }

      return left.position - right.position;
    })
    .map(({ suggestion }) => suggestion);

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

export const applyPublicationSuggestionGroup = (
  source: string,
  suggestions: PublicationSuggestion[],
): SuggestionGroupApplyResult => {
  const applicableSuggestions = suggestions
    .filter((suggestion) => suggestion.status === "pending")
    .map((suggestion) => {
      const match = findSuggestionMatch(source, suggestion);
      return match ? { suggestion, match } : { suggestion, match: null };
    });

  const matchedSuggestions = applicableSuggestions
    .filter((value): value is { suggestion: PublicationSuggestion; match: SuggestionMatch } => value.match !== null)
    .sort((left, right) => right.match.start - left.match.start);

  let nextMarkdown = source;
  const appliedIds: string[] = [];

  for (const { suggestion, match } of matchedSuggestions) {
    nextMarkdown = `${nextMarkdown.slice(0, match.start)}${suggestion.replacement_text}${nextMarkdown.slice(match.end)}`;
    appliedIds.push(suggestion.id);
  }

  return {
    markdown: nextMarkdown,
    appliedIds,
    conflictIds: applicableSuggestions
      .filter(({ suggestion }) => !appliedIds.includes(suggestion.id))
      .map(({ suggestion }) => suggestion.id),
  };
};

const isSameBlock = (suggestionBlockId: string | null | undefined, blockId: string): boolean => {
  if (!suggestionBlockId) return false;
  if (suggestionBlockId === blockId) return true;
  const suggestionLogicalId = parseCorrectionBlockLogicalId(suggestionBlockId);
  const blockLogicalId = parseCorrectionBlockLogicalId(blockId);

  if (suggestionLogicalId && blockLogicalId) {
    return suggestionLogicalId === blockLogicalId;
  }

  const suggestionPos = parseCorrectionBlockPosition(suggestionBlockId);
  const blockPos = parseCorrectionBlockPosition(blockId);
  return suggestionPos !== null && blockPos !== null && suggestionPos === blockPos;
};

export const invalidateBlockSuggestions = (
  suggestions: PublicationSuggestion[],
  block: { id: string; text: string },
  staleSince = Date.now(),
  markResolvableStale = true,
): StaleInvalidationResult => {
  const keptIds: string[] = [];
  const droppedIds: string[] = [];

  const nextSuggestions = suggestions.flatMap((suggestion) => {
    if (!isSameBlock(suggestion.block_id, block.id)) {
      return [suggestion];
    }

    if (
      (suggestion.status === "pending" || suggestion.status === "pending-stale") &&
      findTokenBoundaryMatch(
        block.text,
        suggestion.original_text,
        suggestion.replacement_text,
        null,
        null,
        null,
      )
    ) {
      keptIds.push(suggestion.id);
      return [markResolvableStale ? markSuggestionStale(suggestion, staleSince) : suggestion];
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

export const replaceBlockSuggestions = (
  suggestions: PublicationSuggestion[],
  blockId: string,
  nextBlockSuggestions: PublicationSuggestion[],
): BlockSuggestionReplacementResult => {
  const replacedIds = suggestions
    .filter((suggestion) => isSameBlock(suggestion.block_id, blockId))
    .map((suggestion) => suggestion.id);

  return {
    suggestions: [
      ...suggestions.filter((suggestion) => !isSameBlock(suggestion.block_id, blockId)),
      ...nextBlockSuggestions,
    ],
    replacedIds,
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
    occurrence: countTokenBoundaryMatchesBefore(source, normalizedOriginal, firstIndex),
  };
};

export const findChecklistMatch = (source: string, item: PublicationChecklistItem) => {
  if (!item.target_text) {
    return null;
  }

  return findTokenBoundaryMatch(source, item.target_text, item.target_text, null, null);
};
