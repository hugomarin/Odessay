import type { JSONContent } from "@tiptap/core"
import { ReadingTopbar } from "./reading-topbar"
import { ReadingContent } from "./reading-content"

export type ReadingViewProps = {
  writing: {
    id: string
    title: string | null
    bodyJson: JSONContent | null
    bodyText: string
    updatedAt: string
  }
  author: {
    displayName: string
    username: string
  } | null
  prevWritingId?: string | null
  nextWritingId?: string | null
  sequencePosition?: number | null
  sequenceTotal?: number | null
  canRespond: boolean
  backUrl?: string
}

export function ReadingView({
  writing,
  author,
  prevWritingId = null,
  nextWritingId = null,
  sequencePosition = null,
  sequenceTotal = null,
  canRespond,
  backUrl = "/shared",
}: ReadingViewProps) {
  return (
    <section
      id="reading-view"
      data-page="reading-view"
      className="flex h-screen flex-col overflow-hidden bg-bg"
    >
      <ReadingTopbar
        writingId={writing.id}
        backUrl={backUrl}
        prevWritingId={prevWritingId}
        nextWritingId={nextWritingId}
        sequencePosition={sequencePosition}
        sequenceTotal={sequenceTotal}
        canRespond={canRespond}
      />

      <div className="flex flex-1 overflow-hidden">
        <ReadingContent
          title={writing.title}
          bodyJson={writing.bodyJson}
          bodyText={writing.bodyText}
          author={author}
          updatedAt={writing.updatedAt}
        />
        {/* ReadingMarginPanel — implemented in next issue */}
      </div>
    </section>
  )
}
