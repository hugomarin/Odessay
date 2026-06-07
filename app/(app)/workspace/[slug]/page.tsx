import { WorkspaceDetailPrototype } from "@/components/workspace/workspace-prototype-shell"

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  return <WorkspaceDetailPrototype workspaceSlug={slug} />
}

export function generateStaticParams() {
  return [{ slug: "placeholder" }]
}
