import { BASE_MANDATORY_WRITING_STATUSES, BASE_WRITING_STATUS_KEYS } from "@/lib/vocabulary/base-items"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import { getVocabularyLabel, getVocabularyPosition } from "@/lib/vocabulary/resolve"

/** The base statuses — the default vocabulary a user starts with (`lib/vocabulary/base-items.ts`), not a closed set anymore. */
export const WRITING_STATUS_VALUES = BASE_WRITING_STATUS_KEYS

/**
 * Opened per ODE-474 requirement 7 — a user can create a custom status, so
 * this is no longer a closed union. `WRITING_STATUS_VALUES` above stays as
 * the base defaults for seeding/iteration, not as the type's domain.
 */
export type WritingStatus = string
export type LegacyWritingStatus = WritingStatus | "finished"

export const MANDATORY_WRITING_STATUSES: WritingStatus[] = [...BASE_MANDATORY_WRITING_STATUSES]

/**
 * Preserves an unrecognized value instead of coercing it to "draft"
 * (requirement 5 — the coercion was silent data loss for a custom status).
 * Only fills in a genuinely absent value; a known-but-foreign value is not
 * "unknown input to reject", it's a custom vocabulary key to keep.
 */
export const normalizeWritingStatus = (value: string | null | undefined): WritingStatus => {
  if (value === "finished") {
    return "done"
  }
  if (value === null || value === undefined || value === "") {
    return "draft"
  }
  return value
}

export const getWritingStatusLabel = (status: LegacyWritingStatus): string =>
  getVocabularyLabel(getVocabularyCatalogSnapshot(), "status", normalizeWritingStatus(status))

/**
 * Context Gap against [ODE-472] (documented in the ODE-474 PR): the
 * vocabulary model has no "open/terminal" property a custom status could
 * set, so this still reads the same base literal list it always has instead
 * of a catalog property. A custom status is treated as open (not terminal)
 * by default. Do not extend this list for new base behavior — resolving it
 * properly needs a schema change to `vocabulary_items`, which is out of this
 * issue's scope.
 */
const CLOSED_BASE_STATUSES = new Set(["done", "archived", "canceled"])

export const isOpenWritingStatus = (status: LegacyWritingStatus): boolean => {
  const normalized = normalizeWritingStatus(status)
  return !CLOSED_BASE_STATUSES.has(normalized)
}

export const getWritingStatusOrder = (status: WritingStatus): number =>
  getVocabularyPosition(getVocabularyCatalogSnapshot(), "status", status)

export const sortWritingStatuses = (statuses: WritingStatus[]): WritingStatus[] =>
  [...statuses].sort((a, b) => getWritingStatusOrder(a) - getWritingStatusOrder(b))
