import { Suspense } from "react"
import { CollectionsView } from "@/components/collections/collections-view"
import { DesktopCollectionsEntry } from "@/components/collections/desktop-collections-entry"

const isTauriBuild = process.env.TAURI_BUILD === "true"

export default function CollectionsPage() {
  if (isTauriBuild) {
    // useSearchParams (inside DesktopCollectionsEntry) requires a Suspense
    // boundary in the static export build.
    return (
      <Suspense fallback={null}>
        <DesktopCollectionsEntry />
      </Suspense>
    )
  }

  return <CollectionsView />
}
