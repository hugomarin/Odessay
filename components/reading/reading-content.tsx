import type { JSONContent } from "@tiptap/core"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html-client"
import { WritingContentFrame } from "./writing-content-frame"
import { type SelectionPreviewRect } from "./margins/selection-preview-layer"

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? "" : "s"} ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) === 1 ? "" : "s"} ago`
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) === 1 ? "" : "s"} ago`
}

// Deterministic avatar background from display name
function getAvatarHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}

type ReadingContentProps = {
  title: string | null
  bodyJson: JSONContent | null
  bodyText: string
  author: {
    displayName: string
    username: string
  } | null
  updatedAt: string
  bodyRef?: React.RefObject<HTMLDivElement | null>
  selectionPreviewRects?: SelectionPreviewRect[] | null
}

export function ReadingContent({
  title,
  bodyJson,
  bodyText,
  author,
  updatedAt,
  bodyRef,
  selectionPreviewRects,
}: ReadingContentProps) {
  const { bodyHtml } = renderWritingBodyHtml(bodyJson, bodyText)

  const displayName = author?.displayName ?? author?.username ?? "Odessay author"
  const initials = getInitials(displayName)
  const hue = getAvatarHue(displayName)
  const relativeDate = formatRelativeDate(updatedAt)

  return (
    <div
      id="reading-text"
      data-section="reading-text"
      data-testid="reading-text"
      className="ReadingText relative min-h-0 flex-1 overflow-y-auto"
    >
      <WritingContentFrame
        title={title}
        bodyHtml={bodyHtml}
        bodyId="reading-body"
        bodyTestId="reading-body"
        bodyRef={bodyRef}
        selectionPreviewRects={selectionPreviewRects ?? null}
        showTitle={false}
      >
        {/* Author block */}
        <div className="mb-8 flex items-center gap-3 border-b-[0.5px] border-border pb-4 sm:mb-11 sm:pb-6">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white sm:h-[38px] sm:w-[38px] sm:text-[12px]"
            style={{ backgroundColor: `hsl(${hue}, 30%, 45%)` }}
            aria-label={displayName}
          >
            {initials}
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink-3 sm:text-[14px]">{displayName}</p>
            <p className="text-[11px] text-ink-4 sm:text-[12px]">{relativeDate}</p>
          </div>
        </div>

      </WritingContentFrame>
    </div>
  )
}
