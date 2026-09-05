import { MANDATORY_WRITING_STATUSES } from "@/lib/writings/status"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import { listVisibleVocabulary } from "@/lib/vocabulary/resolve"

/**
 * The vocabulary Settings renders — artifact types and writing statuses as one
 * shape, because `docs/design/views/settings.md` makes them "the same component
 * with a different item shape".
 *
 * **ODE-474.** This module used to own a seed of appearance data (icon, color,
 * description per built-in type/status) because nothing else did. That data
 * is now the user's — it lives in the shared vocabulary catalog
 * (`lib/vocabulary/catalog.ts`, fed by `SettingsService`). This module keeps
 * only what stays universal regardless of any one user's vocabulary: the
 * closed icon sets and the six-color palette Settings' editor picks from.
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
  // Brighter additions (user request, 2026-09-05) — same six muted tones
  // above stay put, these sit alongside them for more punch.
  { id: "red", name: "Red", hex: "#E5484D", tint: "#FCE9EA" },
  { id: "pink", name: "Pink", hex: "#E93D82", tint: "#FCE8F0" },
  { id: "blue", name: "Blue", hex: "#0090FF", tint: "#E0F2FF" },
  { id: "lime", name: "Lime", hex: "#AAD500", tint: "#F5FAE0" },
  { id: "orange", name: "Orange", hex: "#FF8C1A", tint: "#FFF1E4" },
  { id: "yellow", name: "Yellow", hex: "#F5D90A", tint: "#FEFAE2" },
] as const

const TINT_BY_HEX = new Map(VOCABULARY_COLORS.map((color) => [color.hex.toLowerCase(), color.tint]))

/** The chip background for a colour. Falls back to the Grey tint, as the prototype does. */
export function getVocabularyTint(hex: string): string {
  return TINT_BY_HEX.get(hex.toLowerCase()) ?? "#EFEDEA"
}

/**
 * The prototype's `TYPE_ICONS` declares the first twelve — requirement 7.
 * Extended with 20 more (user request, 2026-09-05) for more variety when
 * naming a custom artifact type.
 */
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
  "code",
  "image",
  "video",
  "link",
  "calendar",
  "map",
  "clipboard",
  "lightbulb",
  "rocket",
  "puzzle",
  "shield",
  "users",
  "briefcase",
  "graduation-cap",
  "music",
  "camera",
  "terminal",
  "database",
  "pen-tool",
  "folder",
] as const

/**
 * The prototype's `STATUS_ICONS` declares the first eight — requirement 7.
 * Extended with 18 more (user request, 2026-09-05) for more variety when
 * naming a custom writing status.
 */
export const WRITING_STATUS_ICON_NAMES = [
  "circle-dot",
  "circle-dashed",
  "circle",
  "eye",
  "circle-check",
  "archive",
  "circle-x",
  "flame",
  "clock",
  "alert-triangle",
  "hourglass",
  "thumbs-up",
  "star",
  "bookmark",
  "lock",
  "unlock",
  "zap",
  "send",
  "inbox",
  "shield-check",
  "flag",
  "trending-up",
  "rotate-cw",
  "pin",
  "ban",
  "pause",
] as const

export type VocabularyIconName =
  | (typeof ARTIFACT_TYPE_ICON_NAMES)[number]
  | (typeof WRITING_STATUS_ICON_NAMES)[number]

export type VocabularyItem = {
  /**
   * The catalog item's resolvable id — `updateVocabularyItem`/`deleteVocabularyItem`
   * key off this, not the human-readable `key` slug (synthetic `base:<kind>:<key>`
   * for an unmaterialized base item, the real row UUID once it is).
   */
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

const TYPE_LOCK_NOTE = "Base type: you can change its name, icon, color and description, not delete it."
const BASE_STATUS_LOCK_NOTE = "Base status: you can change its name, icon, color and description, not delete it."
const REQUIRED_STATUS_LOCK_NOTE = "Draft is the default status of every new artifact. It cannot be hidden or deleted."

/** Reads the shared catalog (base items + whatever the user created) instead of a local seed. */
export function getArtifactTypeVocabulary(): VocabularyItem[] {
  return listVisibleVocabulary(getVocabularyCatalogSnapshot(), "type").map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    icon: item.icon as VocabularyIconName,
    color: item.color,
    locked: item.isBase,
    lockNote: item.isBase ? TYPE_LOCK_NOTE : undefined,
  }))
}

/**
 * `enabled` reads straight off the catalog item's own `hidden` flag — the
 * switch here writes it back through `updateVocabularyItem({ hidden })`, the
 * same real vocabulary CRUD Save/Delete already use, so there's no separate
 * `disabledStatuses` array to keep in sync. Name, icon, color and description
 * come from the catalog too, not a local seed.
 */
export function getWritingStatusVocabulary(): VocabularyItem[] {
  // Settings must show every status, hidden ones included — hidden is what
  // the switch here toggles, unlike menus/filters (`listVisibleVocabulary`)
  // which should exclude them.
  return getVocabularyCatalogSnapshot()
    .filter((item) => item.kind === "status")
    .sort((a, b) => a.position - b.position)
    .map((item) => {
      const required = MANDATORY_WRITING_STATUSES.includes(item.key)

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        icon: item.icon as VocabularyIconName,
        color: item.color,
        // `locked` blocks delete only (any base item, required or not) — the
        // switch is gated by `required` alone, below. Conflating the two used
        // to make every base status un-hideable, not just draft.
        locked: item.isBase,
        lockNote: required ? REQUIRED_STATUS_LOCK_NOTE : item.isBase ? BASE_STATUS_LOCK_NOTE : undefined,
        enabled: !item.hidden,
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
