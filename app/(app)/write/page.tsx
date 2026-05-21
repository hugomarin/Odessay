import { EditorShell } from "@/components/editor/editor-shell"

type WritePageProps = {
  searchParams?: Promise<{
    new?: string
  }>
}

export default async function WritePage({ searchParams }: WritePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const forceNewWriting = resolvedSearchParams?.new === "1"

  return <EditorShell key={forceNewWriting ? "write-new" : "write-root"} forceNewWriting={forceNewWriting} />
}
