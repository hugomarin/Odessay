import { BASE_VOCABULARY_ITEMS } from "@/lib/vocabulary/base-items"
import type { VocabularyItem } from "@/lib/vocabulary/types"

/**
 * The single in-memory vocabulary catalog (ODE-474 requirement 1). A plain
 * module-level singleton, not a React context, on purpose: it lets the
 * existing synchronous label/color helpers (`getWritingStatusLabel`,
 * `getArtifactTypeColor`, ...) keep their signatures and read "whatever the
 * catalog currently is" without becoming async, while `useVocabulary()`
 * subscribes to the same store via `useSyncExternalStore` for reactive
 * repaint (requirement 9) — one external source, two ways to read it.
 *
 * `VocabularyCatalogBridge` (mounted once in `app/(app)/layout.tsx`) is the
 * only writer: it forwards `UserSettingsProvider`'s already-fetched
 * `settings.vocabulary` here, so there is no second vocabulary fetch per
 * session (Performance Contract: waterfall shape).
 */

/**
 * Computed lazily, not at module scope: `base-items.ts` imports
 * `lib/settings/vocabulary.ts` (for the icon/color closed sets), which reads
 * the live catalog from this module — a genuine import cycle. ES modules
 * resolve that fine for live bindings, but an eager top-level
 * `BASE_VOCABULARY_ITEMS.map(...)` here would run before `base-items.ts`
 * finishes initializing on whichever side of the cycle loads first, and
 * throw on `undefined`. Deferring the computation to first read sidesteps
 * the ordering entirely.
 */
function buildDefaultCatalog(): readonly VocabularyItem[] {
  return BASE_VOCABULARY_ITEMS.map((def, index) => ({
    id: `base:${def.kind}:${def.key}`,
    kind: def.kind,
    key: def.key,
    name: def.name,
    description: def.description,
    icon: def.icon,
    color: def.color,
    hidden: false,
    isBase: true,
    isRequired: def.isRequired,
    position: index,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }))
}

let current: readonly VocabularyItem[] | null = null
const listeners = new Set<() => void>()

export function getVocabularyCatalogSnapshot(): readonly VocabularyItem[] {
  if (current === null) {
    current = buildDefaultCatalog()
  }
  return current
}

/** Failure modes (catalog load error, partial response): callers fall back to base items, never an empty list — see `VocabularyCatalogBridge`. */
export function setVocabularyCatalog(items: readonly VocabularyItem[]): void {
  current = items.length > 0 ? items : buildDefaultCatalog()
  for (const listener of listeners) listener()
}

export function resetVocabularyCatalogForTest(): void {
  current = null
}

export function subscribeVocabularyCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
