import { notFound, permanentRedirect, redirect } from "next/navigation"
import { EditorShell } from "@/components/editor/editor-shell"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isUuidLikeWritingIdentifier } from "@/lib/writings/writing-route"
import { resolveWriteDetailRoute } from "@/lib/writings/write-detail-route"

type WriteDetailPageProps = {
  params: Promise<{ id: string }>
}

const WRITING_SELECT = "id, title, slug, body_json, body_text, updated_at, author_id, visibility, deleted_at, status, version, sync_status, parent_id, correspondence_id"

const resolveOwnedWriting = async (userId: string, identifier: string) => {
  const admin = createAdminClient()
  const lookupOrder = isUuidLikeWritingIdentifier(identifier) ? ["id", "slug"] : ["slug", "id"]

  for (const field of lookupOrder) {
    const { data, error } = await admin
      .from("writings")
      .select(WRITING_SELECT)
      .eq("author_id", userId)
      .is("deleted_at", null)
      .eq(field, identifier)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (data) {
      return data
    }
  }

  return null
}

export default async function WriteDetailPage({ params }: WriteDetailPageProps) {
  const { id: identifier } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const writing = await resolveOwnedWriting(user.id, identifier)

  const routeResolution = resolveWriteDetailRoute(identifier, writing)

  if (routeResolution.kind === "not-found") {
    notFound()
  }

  if (routeResolution.kind === "redirect") {
    permanentRedirect(routeResolution.href)
  }

  return <EditorShell key={routeResolution.writingId} writingId={routeResolution.writingId} />
}

export function generateStaticParams() {
  return [{ id: "placeholder" }]
}
