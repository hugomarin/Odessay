import { ARTIFACT_TYPE_VALUES, type ArtifactType } from "@/lib/writings/artifact-type"
import { MANDATORY_WRITING_STATUSES, WRITING_STATUS_VALUES, type WritingStatus } from "@/lib/writings/status"
import { VOCABULARY_COLORS, type VocabularyIconName } from "@/lib/settings/vocabulary"
import type { VocabularyKind } from "@/lib/vocabulary/types"

/**
 * The single definition of the base vocabulary items (requirement 6). Icons
 * come from the closed sets in `lib/settings/vocabulary.ts`
 * (`ARTIFACT_TYPE_ICON_NAMES` / `WRITING_STATUS_ICON_NAMES`), colors from the
 * six `VOCABULARY_COLORS`. `key` values are exactly what the DB already stores
 * — this is a rename-only surface, never a value migration.
 *
 * Kept in sync by hand with the literal seed values in
 * `supabase/migrations/20260903190200_seed_vocabulary_from_disabled_statuses.sql`,
 * which cannot import TypeScript.
 */

const INK = VOCABULARY_COLORS.find((c) => c.id === "ink")!.hex
const TERRACOTTA = VOCABULARY_COLORS.find((c) => c.id === "terracotta")!.hex
const AMBER = VOCABULARY_COLORS.find((c) => c.id === "amber")!.hex
const GREEN = VOCABULARY_COLORS.find((c) => c.id === "green")!.hex
const VIOLET = VOCABULARY_COLORS.find((c) => c.id === "violet")!.hex
const GREY = VOCABULARY_COLORS.find((c) => c.id === "grey")!.hex

export type BaseVocabularyDefinition = {
  kind: VocabularyKind
  key: string
  name: string
  description: string
  icon: VocabularyIconName
  color: string
  isRequired: boolean
  position: number
}

const ARTIFACT_TYPE_BASE: Record<ArtifactType, Omit<BaseVocabularyDefinition, "kind" | "key" | "position">> = {
  general: {
    name: "General",
    description: "Anything that does not fit another shape. The default.",
    icon: "file-text",
    color: INK,
    isRequired: false,
  },
  agent: {
    name: "Agent",
    description: "Instructions for an agent: role, limits and exit criteria.",
    icon: "bot",
    color: VIOLET,
    isRequired: false,
  },
  skill: {
    name: "Skill",
    description: "A reusable procedure an agent can follow step by step.",
    icon: "wrench",
    color: TERRACOTTA,
    isRequired: false,
  },
  prompt: {
    name: "Prompt",
    description: "A prompt you mean to reuse and version.",
    icon: "message-square",
    color: AMBER,
    isRequired: false,
  },
  template: {
    name: "Template",
    description: "A starting shape you copy into new artifacts.",
    icon: "layout-template",
    color: GREEN,
    isRequired: false,
  },
  status: {
    name: "Status",
    description: "A running account of where something stands.",
    icon: "list-checks",
    color: GREY,
    isRequired: false,
  },
}

const WRITING_STATUS_BASE: Record<WritingStatus, Omit<BaseVocabularyDefinition, "kind" | "key" | "position">> = {
  new: {
    name: "New",
    description: "It exists but nobody has worked on it yet.",
    icon: "circle-dot",
    color: GREY,
    isRequired: false,
  },
  exploring: {
    name: "Exploring",
    description: "Trying ideas out: it can still change shape completely.",
    icon: "circle-dashed",
    color: VIOLET,
    isRequired: false,
  },
  draft: {
    name: "Draft",
    description: "It has a shape and can be read end to end.",
    icon: "circle-dashed",
    color: AMBER,
    isRequired: true,
  },
  in_review: {
    name: "In Review",
    description: "Waiting on other eyes before closing it.",
    icon: "eye",
    color: TERRACOTTA,
    isRequired: false,
  },
  done: {
    name: "Done",
    description: "Finished. Touched again only if the context changes.",
    icon: "circle-check",
    color: GREEN,
    isRequired: false,
  },
  archived: {
    name: "Archived",
    description: "Out of circulation, but kept.",
    icon: "archive",
    color: INK,
    isRequired: false,
  },
  canceled: {
    name: "Canceled",
    description: "",
    icon: "circle-x",
    color: GREY,
    isRequired: false,
  },
}

export const BASE_ARTIFACT_TYPE_ITEMS: BaseVocabularyDefinition[] = ARTIFACT_TYPE_VALUES.map(
  (key, position) => ({ kind: "type", key, position, ...ARTIFACT_TYPE_BASE[key] }),
)

export const BASE_WRITING_STATUS_ITEMS: BaseVocabularyDefinition[] = WRITING_STATUS_VALUES.map(
  (key, position) => ({ kind: "status", key, position, ...WRITING_STATUS_BASE[key] }),
)

export const BASE_VOCABULARY_ITEMS: BaseVocabularyDefinition[] = [
  ...BASE_ARTIFACT_TYPE_ITEMS,
  ...BASE_WRITING_STATUS_ITEMS,
]

export function isBaseVocabularyKey(kind: VocabularyKind, key: string): boolean {
  if (kind === "type") {
    return (ARTIFACT_TYPE_VALUES as readonly string[]).includes(key)
  }
  return (WRITING_STATUS_VALUES as readonly string[]).includes(key)
}

export function isRequiredVocabularyKey(kind: VocabularyKind, key: string): boolean {
  if (kind !== "status") return false
  return (MANDATORY_WRITING_STATUSES as readonly string[]).includes(key)
}

export function getBaseVocabularyDefinition(
  kind: VocabularyKind,
  key: string,
): BaseVocabularyDefinition | undefined {
  return BASE_VOCABULARY_ITEMS.find((item) => item.kind === kind && item.key === key)
}
