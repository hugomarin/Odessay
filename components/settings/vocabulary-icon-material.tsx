"use client"

import type { VocabularyIconName } from "@/lib/settings/vocabulary"

/**
 * Experimental (ODE-472 icon punch exploration): Material Symbols Outlined
 * equivalent of `VocabularyIcon`'s Lucide map. Ligature-based — the class
 * renders whichever glyph its text content names. A couple of names have no
 * exact Material equivalent (there is no "dashed circle"); those fall back
 * to the closest shape rather than an unrelated glyph.
 */
const MATERIAL_ICONS: Record<VocabularyIconName, string> = {
  "file-text": "description",
  bot: "smart_toy",
  wrench: "build",
  "message-square": "chat_bubble",
  "layout-template": "dashboard",
  "sticky-note": "sticky_note_2",
  "book-open": "menu_book",
  compass: "explore",
  "flask-conical": "science",
  quote: "format_quote",
  "list-checks": "checklist",
  mic: "mic",
  "circle-dot": "radio_button_checked",
  "circle-dashed": "pending",
  circle: "radio_button_unchecked",
  eye: "visibility",
  "circle-check": "check_circle",
  archive: "archive",
  "circle-x": "cancel",
  flame: "local_fire_department",
  code: "code",
  image: "image",
  video: "videocam",
  link: "link",
  calendar: "calendar_month",
  map: "map",
  clipboard: "assignment",
  lightbulb: "lightbulb",
  rocket: "rocket_launch",
  puzzle: "extension",
  shield: "shield",
  users: "group",
  briefcase: "work",
  "graduation-cap": "school",
  music: "music_note",
  camera: "photo_camera",
  terminal: "terminal",
  database: "database",
  "pen-tool": "draw",
  folder: "folder",
  clock: "schedule",
  "alert-triangle": "warning",
  hourglass: "hourglass_empty",
  "thumbs-up": "thumb_up",
  star: "star",
  bookmark: "bookmark",
  lock: "lock",
  unlock: "lock_open",
  zap: "bolt",
  send: "send",
  inbox: "inbox",
  "shield-check": "verified",
  flag: "flag",
  "trending-up": "trending_up",
  "rotate-cw": "autorenew",
  pin: "push_pin",
  ban: "block",
  pause: "pause_circle",
}

export function VocabularyIconMaterial({
  name,
  size = 17,
  filled = false,
  className,
  style,
}: {
  name: VocabularyIconName
  size?: number
  /** FILL axis: 0 = outline (default), 1 = solid. */
  filled?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={`material-symbols-outlined ${className ?? ""}`}
      style={{
        fontSize: size,
        width: size,
        height: size,
        fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" 400, "GRAD" 0, "opsz" 24`,
        ...style,
      }}
    >
      {MATERIAL_ICONS[name]}
    </span>
  )
}
