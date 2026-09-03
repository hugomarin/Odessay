import {
  ARTIFACT_TYPE_ICON_NAMES,
  VOCABULARY_COLORS,
  WRITING_STATUS_ICON_NAMES,
  type VocabularyIconName,
} from "@/lib/settings/vocabulary"
import type { VocabularyKind } from "@/lib/vocabulary/types"

const ARTIFACT_TYPE_ICON_SET = new Set<string>(ARTIFACT_TYPE_ICON_NAMES)
const WRITING_STATUS_ICON_SET = new Set<string>(WRITING_STATUS_ICON_NAMES)
const VOCABULARY_COLOR_HEX_SET = new Set<string>(VOCABULARY_COLORS.map((c) => c.hex.toLowerCase()))

const MAX_NAME_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 180

export type VocabularyValidationError = {
  field: string
  message: string
}

/**
 * The icon a `kind` may use. Requirement 6: types get the twelve
 * `ARTIFACT_TYPE_ICON_NAMES`, statuses get the eight `WRITING_STATUS_ICON_NAMES` —
 * two separate closed sets, not one union, so a status can't be assigned a
 * type-only icon and vice versa.
 */
export function isValidVocabularyIcon(kind: VocabularyKind, icon: string): icon is VocabularyIconName {
  return kind === "type" ? ARTIFACT_TYPE_ICON_SET.has(icon) : WRITING_STATUS_ICON_SET.has(icon)
}

export function isValidVocabularyColor(color: string): boolean {
  return VOCABULARY_COLOR_HEX_SET.has(color.toLowerCase())
}

/**
 * Validates the fields of a vocabulary item the app is about to create or
 * update. Does not check uniqueness, base/required protections or usage —
 * those depend on the user's existing rows and are checked by the caller
 * (route handler / adapter), which has that context.
 */
export function validateVocabularyItemFields(
  kind: VocabularyKind,
  fields: { name?: string; description?: string; icon?: string; color?: string },
): VocabularyValidationError[] {
  const errors: VocabularyValidationError[] = []

  if (fields.name !== undefined) {
    const trimmed = fields.name.trim()
    if (trimmed.length === 0) {
      errors.push({ field: "name", message: "Name cannot be empty." })
    } else if (trimmed.length > MAX_NAME_LENGTH) {
      errors.push({ field: "name", message: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` })
    }
  }

  if (fields.description !== undefined && fields.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({
      field: "description",
      message: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
    })
  }

  if (fields.icon !== undefined && !isValidVocabularyIcon(kind, fields.icon)) {
    errors.push({ field: "icon", message: `"${fields.icon}" is not an admissible icon for ${kind}.` })
  }

  if (fields.color !== undefined && !isValidVocabularyColor(fields.color)) {
    errors.push({ field: "color", message: `"${fields.color}" is not one of the six admissible colors.` })
  }

  return errors
}
