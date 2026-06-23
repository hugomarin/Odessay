import { Suspense } from "react"
import { CollectionsView } from "@/components/collections/collections-view"
import { DesktopCollectionsEntry } from "@/components/collections/desktop-collections-entry"
import { isTauriRuntimeServer } from "@/lib/runtime/detect-server"

const isTauriRuntime = isTauriRuntimeServer()

export default function CollectionsPage() {
  if (isTauriRuntime) {
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
