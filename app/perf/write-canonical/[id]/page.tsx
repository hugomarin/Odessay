import { WriteCanonicalHarness } from "./write-canonical-harness"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function WriteCanonicalHarnessPage({ params }: PageProps) {
  const { id } = await params

  return <WriteCanonicalHarness id={id} />
}
