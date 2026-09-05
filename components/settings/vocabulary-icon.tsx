"use client"

import {
  AlertTriangle,
  Archive,
  Ban,
  Bookmark,
  Bot,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Clipboard,
  Clock,
  Code,
  Compass,
  Database,
  Eye,
  FileText,
  Flag,
  FlaskConical,
  Flame,
  Folder,
  GraduationCap,
  Hourglass,
  Image,
  Inbox,
  LayoutTemplate,
  Lightbulb,
  Link2,
  ListChecks,
  Lock,
  Map,
  Mic,
  MessageSquareText,
  Music,
  Pause,
  PenTool,
  Pin,
  Puzzle,
  Quote,
  Rocket,
  RotateCw,
  Send,
  Shield,
  ShieldCheck,
  Star,
  StickyNote,
  Terminal,
  ThumbsUp,
  TrendingUp,
  Unlock,
  Users,
  Video,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"

import type { VocabularyIconName } from "@/lib/settings/vocabulary"
import { VocabularyIconMaterial } from "@/components/settings/vocabulary-icon-material"

/** EXPERIMENT (icon punch exploration, not yet decided) — see `VocabularyIcon` below. */
const USE_MATERIAL_SYMBOLS = true

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
  code: Code,
  image: Image,
  video: Video,
  link: Link2,
  calendar: Calendar,
  map: Map,
  clipboard: Clipboard,
  lightbulb: Lightbulb,
  rocket: Rocket,
  puzzle: Puzzle,
  shield: Shield,
  users: Users,
  briefcase: Briefcase,
  "graduation-cap": GraduationCap,
  music: Music,
  camera: Camera,
  terminal: Terminal,
  database: Database,
  "pen-tool": PenTool,
  folder: Folder,
  clock: Clock,
  "alert-triangle": AlertTriangle,
  hourglass: Hourglass,
  "thumbs-up": ThumbsUp,
  star: Star,
  bookmark: Bookmark,
  lock: Lock,
  unlock: Unlock,
  zap: Zap,
  send: Send,
  inbox: Inbox,
  "shield-check": ShieldCheck,
  flag: Flag,
  "trending-up": TrendingUp,
  "rotate-cw": RotateCw,
  pin: Pin,
  ban: Ban,
  pause: Pause,
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
  // EXPERIMENT (icon punch exploration, not yet decided): Material Symbols
  // Outlined instead of Lucide. Flip USE_MATERIAL_SYMBOLS to false to go
  // back to Lucide with no other change.
  if (USE_MATERIAL_SYMBOLS) {
    return <VocabularyIconMaterial name={name} size={size} className={className} style={style} />
  }

  const Glyph = ICONS[name]
  return <Glyph className={className} style={{ width: size, height: size, ...style }} strokeWidth={2} />
}
