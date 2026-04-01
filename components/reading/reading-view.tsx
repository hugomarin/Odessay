import type { JSONContent } from "@tiptap/core"
import { ReadingInteractiveShell } from "./reading-interactive-shell"

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
  isAuthenticated?: boolean
  chromeMode?: "default" | "public"
  publicHeader?: {
    logoHref: string
    accountHref: string
    accountLabel: string
  }
  respondHref?: string
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
  isAuthenticated = true,
  chromeMode = "default",
  publicHeader,
  respondHref,
}: ReadingViewProps) {
  return (
    <ReadingInteractiveShell
      writing={writing}
      author={author}
      prevWritingId={prevWritingId}
      nextWritingId={nextWritingId}
      sequencePosition={sequencePosition}
      sequenceTotal={sequenceTotal}
      canRespond={canRespond}
      backUrl={backUrl}
      isAuthenticated={isAuthenticated}
      chromeMode={chromeMode}
      publicHeader={publicHeader}
      respondHref={respondHref}
    />
  )
}
