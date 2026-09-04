import { VOCABULARY_COLORS, type VocabularyIconName } from "@/lib/settings/vocabulary"
import type { VocabularyItem, VocabularyKind } from "@/lib/vocabulary/types"

/**
 * The single module that resolves a `(kind, key)` pair against a vocabulary
 * catalog (ODE-474 requirement 4). No component computes a label, icon or
 * color on its own; everything goes through here.
 */

export type ResolvedVocabularyItem = {
  kind: VocabularyKind
  key: string
  name: string
  description: string
  color: string
  icon: VocabularyIconName | null
  hidden: boolean
  isBase: boolean
  isRequired: boolean
  position: number
  /** True when `key` does not exist in the catalog — requirement 6. */
  isUnknown: boolean
}

/**
 * Neutral, theme-independent fallback — requirement 6: a value outside the
 * catalog is never blank or "undefined". Computed lazily, not at module
 * scope: `lib/settings/vocabulary.ts` re-exports through this module in a
 * cycle (base-items.ts -> vocabulary.ts -> resolve.ts -> vocabulary.ts for
 * `VOCABULARY_COLORS`), and an eager top-level read here can run before
 * `vocabulary.ts` finishes initializing on the other side of that cycle.
 */
function unknownColor(): string {
  return VOCABULARY_COLORS.find((c) => c.id === "grey")!.hex
}
const UNKNOWN_POSITION = Number.MAX_SAFE_INTEGER

export function resolveVocabularyItem(
  catalog: readonly VocabularyItem[],
  kind: VocabularyKind,
  key: string,
): ResolvedVocabularyItem {
  const found = catalog.find((item) => item.kind === kind && item.key === key)
  if (found) {
    return { ...found, isUnknown: false }
  }
  return {
    kind,
    key,
    name: key,
    description: "",
    color: unknownColor(),
    icon: null,
    hidden: false,
    isBase: false,
    isRequired: false,
    position: UNKNOWN_POSITION,
    isUnknown: true,
  }
}

export function getVocabularyLabel(catalog: readonly VocabularyItem[], kind: VocabularyKind, key: string): string {
  return resolveVocabularyItem(catalog, kind, key).name
}

export function getVocabularyColor(catalog: readonly VocabularyItem[], kind: VocabularyKind, key: string): string {
  return resolveVocabularyItem(catalog, kind, key).color
}

export function getVocabularyIconName(
  catalog: readonly VocabularyItem[],
  kind: VocabularyKind,
  key: string,
): VocabularyIconName | null {
  return resolveVocabularyItem(catalog, kind, key).icon
}

export function getVocabularyPosition(catalog: readonly VocabularyItem[], kind: VocabularyKind, key: string): number {
  return resolveVocabularyItem(catalog, kind, key).position
}

/** Visible (non-hidden) items of one kind, in catalog `position` order — requirement 8. */
export function listVisibleVocabulary(catalog: readonly VocabularyItem[], kind: VocabularyKind): VocabularyItem[] {
  return catalog
    .filter((item) => item.kind === kind && !item.hidden)
    .sort((a, b) => a.position - b.position)
}
