import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { collectDocumentTextMap } from "@/lib/editor/find-replace"
import { findSuggestionMatch } from "@/lib/editor/suggestion-engine"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { logCorrectionEvent } from "@/lib/observability/corrections-log"

export type ResolvedCorrectionDecoration = {
  suggestion: PublicationSuggestion
  from: number
  to: number
}

type TextMap = ReturnType<typeof collectDocumentTextMap>

const parseBlockPosition = (blockId: string | null | undefined): number | null => {
  if (!blockId) {
    return null
  }

  const raw = blockId.split(":").at(-1)
  const pos = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(pos) ? pos : null
}

const resolveTextMapRange = (
  textMap: TextMap,
  match: { start: number; end: number },
): { from: number; to: number } | null => {
  const mappedPositions = textMap.positions.slice(match.start, match.end)

  if (mappedPositions.length === 0 || mappedPositions.some((position) => position === null)) {
    return null
  }

  const from = mappedPositions[0]
  const last = mappedPositions[mappedPositions.length - 1]

  if (typeof from !== "number" || typeof last !== "number") {
    return null
  }

  return {
    from,
    to: last + 1,
  }
}

const collectBlockTextMap = (
  doc: ProseMirrorNode,
  blockPos: number,
): TextMap | null => {
  if (blockPos < 0 || blockPos > doc.content.size) {
    return null
  }

  let block: ProseMirrorNode | null = null

  doc.descendants((node, pos) => {
    if (pos !== blockPos) {
      return true
    }

    block = node
    return false
  })

  if (!block) {
    return null
  }

  const blockMap = collectDocumentTextMap(block)

  return {
    text: blockMap.text,
    positions: blockMap.positions.map((position) => (position === null ? null : position + blockPos + 1)),
  }
}

export const getResolvedCorrectionText = (
  doc: ProseMirrorNode,
  range: { from: number; to: number },
) => doc.textBetween(range.from, range.to, "", "")

const resolveSuggestionRange = (
  docTextMap: TextMap,
  doc: ProseMirrorNode,
  suggestion: PublicationSuggestion,
) => {
  const blockPos = parseBlockPosition(suggestion.block_id)
  const blockTextMap = blockPos !== null ? collectBlockTextMap(doc, blockPos) : null
  const textMap = blockTextMap ?? docTextMap
  const match = findSuggestionMatch(textMap.text, suggestion)

  if (!match) {
    return null
  }

  return resolveTextMapRange(textMap, match)
}

export const resolveCorrectionDecorationRanges = (
  doc: ProseMirrorNode,
  suggestions: PublicationSuggestion[],
): ResolvedCorrectionDecoration[] => {
  const pendingSuggestions = suggestions.filter(
    (suggestion) => suggestion.status === "pending" || suggestion.status === "pending-stale",
  )

  if (pendingSuggestions.length === 0) {
    return []
  }

  const docTextMap = collectDocumentTextMap(doc)
  const resolved: ResolvedCorrectionDecoration[] = []
  const occupiedRanges: Array<{ from: number; to: number }> = []

  for (const suggestion of pendingSuggestions) {
    const range = resolveSuggestionRange(docTextMap, doc, suggestion)

    if (!range) {
      continue
    }

    const { from, to } = range
    const overlapsExistingRange = occupiedRanges.some((range) => from < range.to && to > range.from)

    if (overlapsExistingRange) {
      logCorrectionEvent({
        type: "decoration:overlap-skip",
        blockId: suggestion.block_id,
        suggestionId: suggestion.id,
        from,
        to,
      })
      continue
    }

    occupiedRanges.push({ from, to })
    resolved.push({ suggestion, from, to })
  }

  return resolved
}
