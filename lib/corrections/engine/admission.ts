import { stableFingerprintFromStoredFingerprint } from "@/lib/corrections/engine/identity"
import { findTokenBoundaryMatch } from "@/lib/corrections/engine/matching"
import { normalizeLearnedWord } from "@/lib/corrections/learned-words"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

export type AdmissionContext = {
  learnedWords: ReadonlySet<string>
  rejectedFingerprints: ReadonlySet<string>
  blockText: (blockId: string) => string | null
}

const suggestionFingerprint = (suggestion: PublicationSuggestion) =>
  stableFingerprintFromStoredFingerprint(suggestion.correction_fingerprint) ??
  [
    suggestion.mechanical_type ?? suggestion.kind,
    suggestion.original_text,
    suggestion.replacement_text,
  ]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|")

const isMalformedSuggestion = (suggestion: PublicationSuggestion) =>
  !suggestion.id ||
  !suggestion.kind ||
  !suggestion.original_text ||
  !suggestion.replacement_text ||
  !suggestion.block_id

const dedupeKey = (suggestion: PublicationSuggestion) =>
  [
    suggestionFingerprint(suggestion),
    suggestion.block_id ?? "",
    suggestion.source_hash ?? "",
    suggestion.occurrence ?? "",
    suggestion.context_before ?? "",
    suggestion.context_after ?? "",
  ].join("|")

export const admitSuggestions = (
  candidates: PublicationSuggestion[],
  ctx: AdmissionContext,
): PublicationSuggestion[] => {
  const seen = new Set<string>()
  const admitted: PublicationSuggestion[] = []

  for (const suggestion of candidates) {
    if (isMalformedSuggestion(suggestion)) {
      console.info(`[corrections] admission dropped malformed suggestion id=${suggestion.id || "unknown"}`)
      continue
    }

    if (ctx.learnedWords.has(normalizeLearnedWord(suggestion.original_text))) {
      continue
    }

    if (ctx.rejectedFingerprints.has(suggestionFingerprint(suggestion))) {
      continue
    }

    const blockId = suggestion.block_id

    if (!blockId) {
      continue
    }

    const source = ctx.blockText(blockId)

    if (
      !source ||
      !findTokenBoundaryMatch(
        source,
        suggestion.original_text,
        suggestion.replacement_text,
        suggestion.context_before,
        suggestion.context_after,
        suggestion.occurrence,
      )
    ) {
      continue
    }

    const key = dedupeKey(suggestion)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    admitted.push(suggestion)
  }

  return admitted
}
