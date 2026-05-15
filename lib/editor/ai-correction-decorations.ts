import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { collectDocumentTextMap } from "@/lib/editor/find-replace"
import { findSuggestionMatch } from "@/lib/editor/suggestion-engine"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

export type ResolvedCorrectionDecoration = {
  suggestion: PublicationSuggestion
  from: number
  to: number
}

export const resolveCorrectionDecorationRanges = (
  doc: ProseMirrorNode,
  suggestions: PublicationSuggestion[],
): ResolvedCorrectionDecoration[] => {
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending")

  if (pendingSuggestions.length === 0) {
    return []
  }

  const { text, positions } = collectDocumentTextMap(doc)
  const resolved: ResolvedCorrectionDecoration[] = []
  const occupiedRanges: Array<{ from: number; to: number }> = []

  for (const suggestion of pendingSuggestions) {
    const match = findSuggestionMatch(text, suggestion)

    if (!match) {
      continue
    }

    const mappedPositions = positions.slice(match.start, match.end)

    if (mappedPositions.length === 0 || mappedPositions.some((position) => position === null)) {
      continue
    }

    const from = mappedPositions[0]
    const last = mappedPositions[mappedPositions.length - 1]

    if (typeof from !== "number" || typeof last !== "number") {
      continue
    }

    const to = last + 1
    const overlapsExistingRange = occupiedRanges.some((range) => from < range.to && to > range.from)

    if (overlapsExistingRange) {
      continue
    }

    occupiedRanges.push({ from, to })
    resolved.push({ suggestion, from, to })
  }

  return resolved
}
