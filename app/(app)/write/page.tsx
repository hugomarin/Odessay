import { Suspense } from "react"
import { EditorShell } from "@/components/editor/editor-shell"
import { DesktopWriteEntry } from "@/components/editor/desktop-write-entry"
import { isTauriRuntimeServer } from "@/lib/runtime/detect-server"

type WritePageProps = {
  searchParams?: Promise<{
    new?: string
  }>
}

const isTauriRuntime = isTauriRuntimeServer()

function DesktopWritePage() {
  // useSearchParams (inside DesktopWriteEntry) requires a Suspense boundary in
  // the static export build.
  return (
    <Suspense fallback={null}>
      <DesktopWriteEntry />
    </Suspense>
  )
}

async function WebWritePage({ searchParams }: WritePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const forceNewWriting = resolvedSearchParams?.new === "1"

  return <EditorShell key={forceNewWriting ? "write-new" : "write-root"} forceNewWriting={forceNewWriting} />
}

export default isTauriRuntime ? DesktopWritePage : WebWritePage
