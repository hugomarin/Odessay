import { EditorShell } from "@/components/editor/editor-shell"

type WriteDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function WriteDetailPage({ params }: WriteDetailPageProps) {
  const { id } = await params

  return <EditorShell writingId={id} />
}
