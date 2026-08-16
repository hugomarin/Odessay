import { getWritingStatusColor } from "@/lib/writings/status-color"
import type { WritingStatus } from "@/lib/writings/status"
import { cn } from "@/lib/utils"

/**
 * The status glyph the Desk prototype draws everywhere a status appears: a 9px
 * ring, 1.5px dashed, in the status colour. One component so the row trigger,
 * the filter menu and the preview's properties column cannot drift apart.
 */
export function DeskStatusDot({
  status,
  className,
}: {
  status: WritingStatus
  className?: string
}) {
  return (
    <span
      aria-hidden
      style={{ borderColor: getWritingStatusColor(status) }}
      className={cn(
        "inline-block h-[9px] w-[9px] flex-shrink-0 rounded-full border-[1.5px] border-dashed",
        className,
      )}
    />
  )
}
