import { Bot, File, FileChartColumn, LayoutTemplate, MessageSquareText, Wrench } from "lucide-react"

import type { ArtifactType } from "@/lib/writings/artifact-type"
import { getArtifactTypeColor } from "@/lib/writings/artifact-type-color"

/**
 * The glyph for an artifact type.
 *
 * It lives in its own module because the Desk's row, its filter menu and the
 * selection bar all need it, and importing it from `desk-activity-table.tsx`
 * dragged that module's whole dependency tree — dialogs, the shared table, the
 * collection menus — into every one of them, and put the row and the table in an
 * import cycle.
 */
export function ArtifactTypeIcon({ artifactType, className }: { artifactType: ArtifactType; className?: string }) {
  const Icon = {
    agent: Bot,
    skill: Wrench,
    prompt: MessageSquareText,
    template: LayoutTemplate,
    status: FileChartColumn,
    general: File,
  }[artifactType]

  return (
    <Icon
      className={className ?? "h-[13px] w-[13px] shrink-0"}
      strokeWidth={1.5}
      style={{ color: getArtifactTypeColor(artifactType) }}
    />
  )
}
