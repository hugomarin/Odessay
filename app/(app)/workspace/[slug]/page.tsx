import { WorkspaceDetail } from "@/components/workspace/workspace-detail"

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  return <WorkspaceDetail workspaceSlug={slug} />
}

export function generateStaticParams() {
  return [{ slug: "placeholder" }]
}
