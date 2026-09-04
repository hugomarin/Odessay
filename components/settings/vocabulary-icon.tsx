"use client"

import {
  Archive,
  Bot,
  BookOpen,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Compass,
  Eye,
  FileText,
  FlaskConical,
  Flame,
  LayoutTemplate,
  ListChecks,
  MessageSquareText,
  Mic,
  Quote,
  StickyNote,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import type { VocabularyIconName } from "@/lib/settings/vocabulary"

/**
 * Name → glyph for the two icon grids in the Settings editor modal.
 *
 * The grids are closed sets (twelve for types, eight for statuses) declared in
 * `lib/settings/vocabulary.ts`; this map only resolves them to components, so a
 * name added there without a glyph here is a type error rather than a blank
 * button.
 */
const ICONS: Record<VocabularyIconName, LucideIcon> = {
  "file-text": FileText,
  bot: Bot,
  wrench: Wrench,
  "message-square": MessageSquareText,
  "layout-template": LayoutTemplate,
  "sticky-note": StickyNote,
  "book-open": BookOpen,
  compass: Compass,
  "flask-conical": FlaskConical,
  quote: Quote,
  "list-checks": ListChecks,
  mic: Mic,
  "circle-dot": CircleDot,
  "circle-dashed": CircleDashed,
  circle: Circle,
  eye: Eye,
  "circle-check": CircleCheck,
  archive: Archive,
  "circle-x": CircleX,
  flame: Flame,
}

export function VocabularyIcon({
  name,
  size = 17,
  className,
  style,
}: {
  name: VocabularyIconName
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  const Glyph = ICONS[name]
  return <Glyph className={className} style={{ width: size, height: size, ...style }} strokeWidth={1.5} />
}
