import type { VocabularyIconName } from "@/lib/settings/vocabulary"
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
 *
 * `lib/writings/status.ts` / `lib/writings/artifact-type.ts` import the base
 * key lists FROM here (not the other way around) — this module must have no
 * dependency on them, since they in turn resolve labels through
 * `lib/vocabulary/catalog.ts`, which is seeded from `BASE_VOCABULARY_ITEMS`.
 * Importing the other direction would be circular.
 */

type BaseArtifactTypeKey = "general" | "agent" | "skill" | "prompt" | "template" | "status"
type BaseWritingStatusKey = "new" | "exploring" | "draft" | "in_review" | "done" | "archived" | "canceled"

/**
 * Literal, not derived from `VOCABULARY_COLORS` in `lib/settings/vocabulary.ts`
 * — importing that value here would be circular (`vocabulary.ts` reads the
 * catalog through `catalog.ts`/`resolve.ts`, both seeded from this file).
 * `tests/vocabulary/base-items.test.ts` asserts these match the palette.
 */
const INK = "#1E1915"
const TERRACOTTA = "#96532C"
const AMBER = "#C07B2A"
const GREEN = "#2E7D4F"
const VIOLET = "#5B5BD6"
const GREY = "#8E837B"

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

const ARTIFACT_TYPE_BASE: Record<BaseArtifactTypeKey, Omit<BaseVocabularyDefinition, "kind" | "key" | "position">> = {
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

const WRITING_STATUS_BASE: Record<BaseWritingStatusKey, Omit<BaseVocabularyDefinition, "kind" | "key" | "position">> = {
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

/** Base type keys, in canonical order — the authority `lib/writings/artifact-type.ts` imports its `ARTIFACT_TYPE_VALUES` from. */
export const BASE_ARTIFACT_TYPE_KEYS = [
  "general",
  "agent",
  "skill",
  "prompt",
  "template",
  "status",
] as const satisfies readonly BaseArtifactTypeKey[]

/** Base status keys, in canonical order — the authority `lib/writings/status.ts` imports its `WRITING_STATUS_VALUES` from. */
export const BASE_WRITING_STATUS_KEYS = [
  "new",
  "exploring",
  "draft",
  "in_review",
  "done",
  "archived",
  "canceled",
] as const satisfies readonly BaseWritingStatusKey[]

export const BASE_MANDATORY_WRITING_STATUSES = ["draft"] as const satisfies readonly BaseWritingStatusKey[]

export const BASE_ARTIFACT_TYPE_ITEMS: BaseVocabularyDefinition[] = BASE_ARTIFACT_TYPE_KEYS.map(
  (key, position) => ({ kind: "type", key, position, ...ARTIFACT_TYPE_BASE[key] }),
)

export const BASE_WRITING_STATUS_ITEMS: BaseVocabularyDefinition[] = BASE_WRITING_STATUS_KEYS.map(
  (key, position) => ({ kind: "status", key, position, ...WRITING_STATUS_BASE[key] }),
)

export const BASE_VOCABULARY_ITEMS: BaseVocabularyDefinition[] = [
  ...BASE_ARTIFACT_TYPE_ITEMS,
  ...BASE_WRITING_STATUS_ITEMS,
]

export function isBaseVocabularyKey(kind: VocabularyKind, key: string): boolean {
  if (kind === "type") {
    return (BASE_ARTIFACT_TYPE_KEYS as readonly string[]).includes(key)
  }
  return (BASE_WRITING_STATUS_KEYS as readonly string[]).includes(key)
}

export function isRequiredVocabularyKey(kind: VocabularyKind, key: string): boolean {
  if (kind !== "status") return false
  return (BASE_MANDATORY_WRITING_STATUSES as readonly string[]).includes(key)
}

export function getBaseVocabularyDefinition(
  kind: VocabularyKind,
  key: string,
): BaseVocabularyDefinition | undefined {
  return BASE_VOCABULARY_ITEMS.find((item) => item.kind === kind && item.key === key)
}
