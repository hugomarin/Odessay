import { CollectionsView } from "@/components/collections/collections-view"

type CollectionDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function CollectionDetailPage({ params }: CollectionDetailPageProps) {
  const { id } = await params

  return <CollectionsView initialExpandedCollectionId={id} />
}
