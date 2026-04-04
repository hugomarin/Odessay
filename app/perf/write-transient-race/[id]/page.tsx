import { notFound, permanentRedirect } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"
import { resolveWriteDetailRoute } from "@/lib/writings/write-detail-route"

type WriteTransientRacePageProps = {
  params: Promise<{ id: string }>
}

const resolveHarnessWriting = (identifier: string) => {
  if (identifier === "fixture-writing-id" || identifier === "semantic-write-title") {
    return {
      id: "fixture-writing-id",
      slug: "semantic-write-title",
    }
  }

  return null
}

export default async function WriteTransientRacePage({ params }: WriteTransientRacePageProps) {
  const { id: identifier } = await params
  const routeResolution = resolveWriteDetailRoute(identifier, resolveHarnessWriting(identifier))

  if (routeResolution.kind === "not-found") {
    notFound()
  }

  if (routeResolution.kind === "redirect") {
    permanentRedirect(routeResolution.href.replace("/write/", "/perf/write-transient-race/"))
  }

  return <EditorShell writingId={routeResolution.writingId} />
}
