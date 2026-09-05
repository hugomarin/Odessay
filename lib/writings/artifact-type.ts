import { BASE_ARTIFACT_TYPE_KEYS } from "@/lib/vocabulary/base-items"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import { getVocabularyLabel } from "@/lib/vocabulary/resolve"

/** The base types — the default vocabulary a user starts with (`lib/vocabulary/base-items.ts`), not a closed set anymore. */
export const ARTIFACT_TYPE_VALUES = BASE_ARTIFACT_TYPE_KEYS

/** Opened per ODE-474 requirement 7 — a user can create a custom type. */
export type ArtifactType = string

export const DEFAULT_ARTIFACT_TYPE: ArtifactType = "general"

/**
 * Preserves an unrecognized value instead of coercing it to "general"
 * (requirement 5). Only fills in a genuinely absent value.
 */
export const normalizeArtifactType = (value: string | null | undefined): ArtifactType =>
  value === null || value === undefined || value === "" ? DEFAULT_ARTIFACT_TYPE : value

export const getArtifactTypeLabel = (artifactType: ArtifactType): string =>
  getVocabularyLabel(getVocabularyCatalogSnapshot(), "type", normalizeArtifactType(artifactType))
