"use client"

import { useSearchParams } from "next/navigation"
import { CollectionsView } from "@/components/collections/collections-view"

/**
 * Desktop entry for the /collections route.
 *
 * The packaged desktop app is a static export with no server, so dynamic path
 * segments like /collections/<uuid> have no generated HTML and fail on hard
 * navigation. Desktop links instead point at /collections?id=<uuid> (see
 * buildCollectionHref), and this client component reads the id from the query
 * string and feeds it to CollectionsView. useSearchParams is reactive, so
 * navigating between collections (query-only navigation) re-renders correctly.
 *
 * The key forces a remount when the target collection changes so per-collection
 * state never leaks between views.
 */
export function DesktopCollectionsEntry() {
  const searchParams = useSearchParams()
  const collectionId = searchParams.get("id")

  return (
    <CollectionsView
      key={collectionId ?? "index"}
      initialExpandedCollectionId={collectionId}
    />
  )
}
