import { Suspense } from "react"
import { redirect } from "next/navigation"
import { DesktopSharedEntry } from "@/components/reading/desktop-shared-entry"
import { isTauriRuntimeServer } from "@/lib/runtime/detect-server"

const isTauriRuntime = isTauriRuntimeServer()

function DesktopSharedPage() {
  return (
    <Suspense fallback={null}>
      <DesktopSharedEntry />
    </Suspense>
  )
}

function WebSharedPage() {
  redirect("/desk?tab=shared")
}

export default isTauriRuntime ? DesktopSharedPage : WebSharedPage
