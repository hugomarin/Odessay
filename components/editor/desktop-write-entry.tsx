"use client"

import { useSearchParams } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"

/**
 * Desktop entry for the /write route.
 *
 * The packaged desktop app is a static export with no server, so dynamic path
 * segments like /write/<uuid> have no generated HTML and fail on hard
 * navigation. Desktop links instead point at /write?id=<uuid> (see
 * buildWritingRouteHref), and this client component reads the id from the query
 * string and feeds it to EditorShell. useSearchParams is reactive, so switching
 * writings via the sidebar/search (query-only navigation) re-renders correctly.
 *
 * The key forces a remount when the target writing changes, matching the web
 * route's keying so per-writing editor state never leaks between documents.
 */
export function DesktopWriteEntry() {
  const searchParams = useSearchParams()
  const writingId = searchParams.get("id") ?? undefined
  const forceNewWriting = searchParams.get("new") === "1"

  return (
    <EditorShell
      key={writingId ?? (forceNewWriting ? "write-new" : "write-root")}
      writingId={writingId}
      forceNewWriting={forceNewWriting}
    />
  )
}
