import { WorkspaceFilePrototype } from "@/components/workspace/workspace-prototype-shell"

export default async function WorkspaceFilePage({
  params,
}: {
  params: Promise<{ slug: string; fileId: string }>
}) {
  const { slug, fileId } = await params

  return <WorkspaceFilePrototype workspaceSlug={slug} fileId={fileId} />
}

export function generateStaticParams() {
  return [{ slug: "placeholder", fileId: "placeholder-file" }]
}
