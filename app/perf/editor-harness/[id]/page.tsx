import { notFound } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function EditorPerfWritingHarnessPage({ params }: PageProps) {
  const isHarnessEnabled =
    process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

  if (!isHarnessEnabled) {
    notFound()
  }

  const { id } = await params
  return <EditorShell writingId={id} />
}

export function generateStaticParams() {
  return [{ id: "placeholder" }]
}
