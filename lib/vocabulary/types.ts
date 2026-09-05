import type { VocabularyIconName } from "@/lib/settings/vocabulary"

export type VocabularyKind = "type" | "status"

/**
 * A single vocabulary row — a type or a status, base or user-created.
 * `key` is the stable identifier that travels in `writings.artifact_type` /
 * `writings.status`; it never changes once created.
 */
export type VocabularyItem = {
  id: string
  kind: VocabularyKind
  key: string
  name: string
  description: string
  icon: VocabularyIconName
  /** Literal hex from `VOCABULARY_COLORS` — user data, not a design token. */
  color: string
  hidden: boolean
  isBase: boolean
  isRequired: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export type CreateVocabularyItemInput = {
  kind: VocabularyKind
  name: string
  description?: string
  icon: VocabularyIconName
  color: string
}

export type UpdateVocabularyItemInput = {
  name?: string
  description?: string
  icon?: VocabularyIconName
  color?: string
  hidden?: boolean
}

export type VocabularyUsage = {
  /** vocabulary item id -> number of writings currently carrying its key. */
  [itemId: string]: number
}
