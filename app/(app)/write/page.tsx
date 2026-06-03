import { Suspense } from "react"
import { EditorShell } from "@/components/editor/editor-shell"
import { DesktopWriteEntry } from "@/components/editor/desktop-write-entry"

type WritePageProps = {
  searchParams?: Promise<{
    new?: string
  }>
}

const isTauriBuild = process.env.TAURI_BUILD === "true"

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

export default isTauriBuild ? DesktopWritePage : WebWritePage
