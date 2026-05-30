import { EditorShell } from "@/components/editor/editor-shell"

type WritePageProps = {
  searchParams?: Promise<{
    new?: string
  }>
}

const isTauriBuild = process.env.TAURI_BUILD === "true"

function DesktopWritePage() {
  return <EditorShell />
}

async function WebWritePage({ searchParams }: WritePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const forceNewWriting = resolvedSearchParams?.new === "1"

  return <EditorShell key={forceNewWriting ? "write-new" : "write-root"} forceNewWriting={forceNewWriting} />
}

export default isTauriBuild ? DesktopWritePage : WebWritePage
