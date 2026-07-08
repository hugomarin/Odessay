import { admitSuggestions, type AdmissionContext } from "@/lib/corrections/engine/admission"
import { createLearnedWordSet } from "@/lib/corrections/learned-words"
import { updateSuggestionStatuses } from "@/lib/editor/suggestion-engine"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import type { LearnedWordEntry } from "@/lib/services/contracts/ai-service"

export const buildLearnWordRollbackState = (input: {
  learnedWords: readonly LearnedWordEntry[]
  optimisticEntryId: string
  suggestions: readonly PublicationSuggestion[]
  targetIds: readonly string[]
  admissionContext: AdmissionContext
}) => {
  const learnedWords = input.learnedWords.filter((item) => item.id !== input.optimisticEntryId)
  const suggestions = admitSuggestions(
    updateSuggestionStatuses([...input.suggestions], [...input.targetIds], "pending"),
    {
      ...input.admissionContext,
      learnedWords: createLearnedWordSet(learnedWords.map((item) => item.word)),
    },
  )

  return {
    learnedWords,
    suggestions,
  }
}
