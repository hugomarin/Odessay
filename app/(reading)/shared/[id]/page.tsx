import { notFound, redirect } from "next/navigation"
import type { Metadata } from "next"
import type { JSONContent } from "@tiptap/core"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { ReadingView } from "@/components/reading/reading-view"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ id: string }>
}

type WritingRow = {
  id: string
  title: string | null
  body_json: JSONContent | null
  body_text: string
  updated_at: string
  author_id: string
  visibility: string
  deleted_at: string | null
  profiles: { username: string; display_name: string } | { username: string; display_name: string }[] | null
}

function normalizeProfile(
  profiles: WritingRow["profiles"],
): { username: string; display_name: string } | null {
  if (!profiles) return null
  if (Array.isArray(profiles)) return profiles[0] ?? null
  return profiles
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const admin = createAdminClient()
  const { data } = await admin.from("writings").select("title").eq("id", id).maybeSingle()
  return { title: data?.title ? `${data.title} — Odessay` : "Reading — Odessay" }
}

export default async function SharedReadingPage({ params }: PageProps) {
  const { id } = await params

  // Auth — require signed-in user
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const admin = createAdminClient()

  // Fetch writing with author profile
  const { data: writing } = await admin
    .from("writings")
    .select("id, title, body_json, body_text, updated_at, author_id, visibility, deleted_at, profiles!author_id(username, display_name)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()

  if (!writing) notFound()

  const isAuthor = writing.author_id === user.id

  // Access check: author can always view; others need a writing_share row
  if (!isAuthor) {
    const { data: shareRow } = await admin
      .from("writing_shares")
      .select("id")
      .eq("writing_id", id)
      .eq("shared_with_id", user.id)
      .maybeSingle()

    if (!shareRow) notFound()
  }

  const profile = normalizeProfile((writing as WritingRow).profiles)

  // Build sequence: all writings shared with this user (or authored), ordered by updated_at desc
  let sharedWritingIds: string[] = []
  if (!isAuthor) {
    const { data: shareRows } = await admin
      .from("writing_shares")
      .select("writing_id")
      .eq("shared_with_id", user.id)

    sharedWritingIds = (shareRows ?? []).map((r: { writing_id: string }) => r.writing_id)
  }

  // Sort the shared IDs by updated_at to build prev/next
  let prevWritingId: string | null = null
  let nextWritingId: string | null = null
  let sequencePosition: number | null = null
  let sequenceTotal: number | null = null

  if (!isAuthor && sharedWritingIds.length > 1) {
    const { data: sequenceWritings } = await admin
      .from("writings")
      .select("id, updated_at")
      .in("id", sharedWritingIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })

    const sequence = sequenceWritings ?? []
    const idx = sequence.findIndex((w: { id: string }) => w.id === id)

    if (idx !== -1) {
      sequencePosition = idx + 1
      sequenceTotal = sequence.length
      prevWritingId = idx > 0 ? (sequence[idx - 1]?.id ?? null) : null
      nextWritingId = idx < sequence.length - 1 ? (sequence[idx + 1]?.id ?? null) : null
    }
  }

  // canRespond: recipient (not the author) can write a response
  const canRespond = !isAuthor

  return (
    <ReadingView
      writing={{
        id: writing.id,
        title: writing.title,
        bodyJson: writing.body_json as JSONContent | null,
        bodyText: writing.body_text,
        updatedAt: writing.updated_at,
      }}
      author={
        profile
          ? { displayName: profile.display_name, username: profile.username }
          : null
      }
      prevWritingId={prevWritingId}
      nextWritingId={nextWritingId}
      sequencePosition={sequencePosition}
      sequenceTotal={sequenceTotal}
      canRespond={canRespond}
      backUrl="/shared"
    />
  )
}
