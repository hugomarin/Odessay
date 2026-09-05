import { useSyncExternalStore } from "react"
import { getVocabularyCatalogSnapshot, subscribeVocabularyCatalog } from "@/lib/vocabulary/catalog"
import type { VocabularyItem } from "@/lib/vocabulary/types"

/**
 * The one hook every component uses to read the vocabulary catalog
 * (requirement 1/4). Backed by `useSyncExternalStore` against the module
 * singleton in `lib/vocabulary/catalog.ts` — a change touching N items
 * updates the store once and every subscriber re-renders together in the
 * same tick (requirement 9/10), no per-component fetch.
 */
export function useVocabulary(): readonly VocabularyItem[] {
  return useSyncExternalStore(subscribeVocabularyCatalog, getVocabularyCatalogSnapshot, getVocabularyCatalogSnapshot)
}
