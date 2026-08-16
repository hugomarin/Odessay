import { MANDATORY_WRITING_STATUSES, WRITING_STATUS_VALUES, getWritingStatusLabel } from "@/lib/writings/status"
import type { WritingStatus } from "@/lib/writings/status"
import { getWritingStatusColor } from "@/lib/writings/status-color"
import { ARTIFACT_TYPE_VALUES, getArtifactTypeLabel } from "@/lib/writings/artifact-type"
import type { ArtifactType } from "@/lib/writings/artifact-type"

/**
 * The vocabulary Settings renders — artifact types and writing statuses as one
 * shape, because `docs/design/views/settings.md` makes them "the same component
 * with a different item shape".
 *
 * **Scope note (ODE-432).** This module describes the vocabulary; it does not
 * own it. The catalogue itself is still the two closed unions in
 * `lib/writings/artifact-type.ts` and `lib/writings/status.ts`, and the only
 * durable user setting is `profiles.disabled_statuses`. Editing a name, icon or
 * colour — and creating an item at all — has nowhere to persist today, so
 * ODE-432 ships the surface and leaves the wiring to its successor. Anything
 * here that looks like user data is a seed read from the prototype, not a store.
 */

export type VocabularyColor = {
  id: string
  /** Shown as the swatch's `title`. */
  name: string
  /** Foreground: the icon inside the chip. */
  hex: string
  /** Chip background — the prototype writes the tints literally, so we do too. */
  tint: string
}

/**
 * The six colours Settings offers, in the order the prototype's `COLORS` array
 * declares them.
 *
 * Divergence recorded in the ODE-432 PR: `docs/design/views/settings.md` and
 * `docs/design/system-app.md` §1 both list Violet before Green; the render puts
 * Green fourth and Violet fifth. Per `docs/design/migration-plan.md` §4 the
 * prototype wins.
 *
 * These are user data, not tokens — `system-app.md` §1 says so explicitly — so
 * they stay literal hex here and are never promoted into `globals.css`.
 */
export const VOCABULARY_COLORS: readonly VocabularyColor[] = [
  { id: "ink", name: "Ink", hex: "#1E1915", tint: "#E7E5E1" },
  { id: "terracotta", name: "Terracotta", hex: "#96532C", tint: "#FAEBDC" },
  { id: "amber", name: "Amber", hex: "#C07B2A", tint: "#FBF0DE" },
  { id: "green", name: "Green", hex: "#2E7D4F", tint: "#E4F0E7" },
  { id: "violet", name: "Violet", hex: "#5B5BD6", tint: "#E7E7FA" },
  { id: "grey", name: "Grey", hex: "#8E837B", tint: "#EFEDEA" },
] as const

const TINT_BY_HEX = new Map(VOCABULARY_COLORS.map((color) => [color.hex.toLowerCase(), color.tint]))

/** The chip background for a colour. Falls back to the Grey tint, as the prototype does. */
export function getVocabularyTint(hex: string): string {
  return TINT_BY_HEX.get(hex.toLowerCase()) ?? "#EFEDEA"
}

/** Exactly the twelve the prototype's `TYPE_ICONS` declares — requirement 7. */
export const ARTIFACT_TYPE_ICON_NAMES = [
  "file-text",
  "bot",
  "wrench",
  "message-square",
  "layout-template",
  "sticky-note",
  "book-open",
  "compass",
  "flask-conical",
  "quote",
  "list-checks",
  "mic",
] as const

/** Exactly the eight the prototype's `STATUS_ICONS` declares — requirement 7. */
export const WRITING_STATUS_ICON_NAMES = [
  "circle-dot",
  "circle-dashed",
  "circle",
  "eye",
  "circle-check",
  "archive",
  "circle-x",
  "flame",
] as const

export type VocabularyIconName =
  | (typeof ARTIFACT_TYPE_ICON_NAMES)[number]
  | (typeof WRITING_STATUS_ICON_NAMES)[number]

export type VocabularyItem = {
  /** The union member this row describes. */
  id: string
  name: string
  description: string
  icon: VocabularyIconName
  /** Literal hex — user data, per `system-app.md` §1. */
  color: string
  /** Built-in types and required statuses: the modal shows a note, not a delete. */
  locked: boolean
  /** Why it cannot be deleted. Rendered in the modal footer. */
  lockNote?: string
  /** Statuses only — drives the "show in menus" switch. */
  enabled?: boolean
  /** Statuses only — the prototype marks required ones next to the name. */
  required?: boolean
}

/**
 * Appearance for the six types the repo actually has.
 *
 * Divergence recorded in the ODE-432 PR: the prototype seeds `Note` and
 * `Transcripción`, the repo's union carries `template` and `status`. ODE-432
 * changes presentation, not the catalogue (requirement 11), so the repo's six
 * win and the prototype's icon/colour assignments carry over for the four names
 * both agree on. `template` and `status` get the palette entries the prototype
 * left unused; their copy is flagged as an open question for the design owner.
 */
const ARTIFACT_TYPE_APPEARANCE: Record<ArtifactType, { icon: VocabularyIconName; color: string; description: string }> = {
  general: {
    icon: "file-text",
    color: "#1E1915",
    description: "Anything that does not fit another shape. The default.",
  },
  agent: {
    icon: "bot",
    color: "#5B5BD6",
    description: "Instructions for an agent: role, limits and exit criteria.",
  },
  skill: {
    icon: "wrench",
    color: "#96532C",
    description: "A reusable procedure an agent can follow step by step.",
  },
  prompt: {
    icon: "message-square",
    color: "#C07B2A",
    description: "A prompt you mean to reuse and version.",
  },
  template: {
    icon: "layout-template",
    color: "#2E7D4F",
    description: "A starting shape you copy into new artifacts.",
  },
  status: {
    icon: "list-checks",
    color: "#8E837B",
    description: "A running account of where something stands.",
  },
}

const TYPE_LOCK_NOTE = "Base type: you can change its icon, color and description, not delete it."

export function getArtifactTypeVocabulary(): VocabularyItem[] {
  return ARTIFACT_TYPE_VALUES.map((type) => ({
    id: type,
    name: getArtifactTypeLabel(type),
    ...ARTIFACT_TYPE_APPEARANCE[type],
    // Every type in the union is built in — the repo has no user-created ones.
    locked: true,
    lockNote: TYPE_LOCK_NOTE,
  }))
}

/**
 * Status copy, translated from the prototype's seed. `canceled` is left without
 * a description there, so it renders the same "No description" fallback the
 * prototype does rather than inventing one.
 */
const WRITING_STATUS_DESCRIPTION: Record<WritingStatus, string> = {
  new: "It exists but nobody has worked on it yet.",
  exploring: "Trying ideas out: it can still change shape completely.",
  draft: "It has a shape and can be read end to end.",
  in_review: "Waiting on other eyes before closing it.",
  done: "Finished. Touched again only if the context changes.",
  archived: "Out of circulation, but kept.",
  canceled: "",
}

const STATUS_ICON: Record<WritingStatus, VocabularyIconName> = {
  new: "circle-dot",
  exploring: "circle-dashed",
  draft: "circle-dashed",
  in_review: "eye",
  done: "circle-check",
  archived: "archive",
  canceled: "circle-x",
}

const STATUS_LOCK_NOTE = "Draft is the default status of every new artifact."

/**
 * Colours come from `lib/writings/status-color.ts`, the one place a status
 * colour is resolved — Settings reads it, it does not fork it. That map returns
 * CSS custom properties, which is what the chip needs anyway.
 */
export function getWritingStatusVocabulary(disabledStatuses: readonly WritingStatus[]): VocabularyItem[] {
  const disabled = new Set(disabledStatuses)

  return WRITING_STATUS_VALUES.map((status) => {
    const required = MANDATORY_WRITING_STATUSES.includes(status)

    return {
      id: status,
      name: getWritingStatusLabel(status),
      description: WRITING_STATUS_DESCRIPTION[status],
      icon: STATUS_ICON[status],
      color: getWritingStatusColor(status),
      locked: required,
      lockNote: required ? STATUS_LOCK_NOTE : undefined,
      enabled: !disabled.has(status),
      required,
    }
  })
}

/**
 * A status chip is tinted from a token, not from the palette above, because its
 * colour is a `var()` rather than a hex. 20 % of the colour reproduces the
 * prototype's tint without a second lookup table.
 */
export function getStatusChipTint(color: string): string {
  return `color-mix(in srgb, ${color} 20%, #FFFFFF)`
}
