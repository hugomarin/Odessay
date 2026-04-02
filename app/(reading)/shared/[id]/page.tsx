import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import type { JSONContent } from "@tiptap/core"
import { ReadingView } from "@/components/reading/reading-view"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { buildWritingRouteHref, isUuidLikeWritingIdentifier } from "@/lib/writings/writing-route"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ id: string }>
}

type WritingRow = {
  id: string
  title: string | null
  slug: string | null
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

const WRITING_SELECT =
  "id, title, slug, body_json, body_text, updated_at, author_id, visibility, deleted_at, profiles!author_id(username, display_name)"

async function resolveSharedWriting(identifier: string): Promise<WritingRow | null> {
  const admin = createAdminClient()
  const lookupOrder = isUuidLikeWritingIdentifier(identifier) ? ["id", "slug"] : ["slug", "id"]

  for (const field of lookupOrder) {
    const { data, error } = await admin
      .from("writings")
      .select(WRITING_SELECT)
      .eq(field, identifier)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (data) {
      return data as WritingRow
    }
  }

  return null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: identifier } = await params
  const writing = await resolveSharedWriting(identifier)

  return {
    title: writing?.title ? `${writing.title} — Odessay` : "Reading — Odessay",
  }
}

export default async function SharedReadingPage({ params }: PageProps) {
  const { id: identifier } = await params

  // Auth — require signed-in user
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const writing = await resolveSharedWriting(identifier)

  if (!writing) notFound()

  const isAuthor = writing.author_id === user.id

  // Access check: author can always view; others need a writing_share row
  if (!isAuthor) {
    const admin = createAdminClient()
    const { data: shareRow } = await admin
      .from("writing_shares")
      .select("id")
      .eq("writing_id", writing.id)
      .eq("shared_with_id", user.id)
      .maybeSingle()

    if (!shareRow) notFound()
  }

  if (writing.slug && identifier !== writing.slug) {
    redirect(`/shared/${writing.slug}`)
  }

  const profile = normalizeProfile((writing as WritingRow).profiles)

  // Build sequence: all writings shared with this user (or authored), ordered by updated_at desc
  let prevWritingId: string | null = null
  let nextWritingId: string | null = null
  let prevWritingHref: string | null = null
  let nextWritingHref: string | null = null
  let sequencePosition: number | null = null
  let sequenceTotal: number | null = null

  if (!isAuthor) {
    const admin = createAdminClient()
    const { data: shareRows } = await admin
      .from("writing_shares")
      .select("writing_id")
      .eq("shared_with_id", user.id)

    const sharedWritingIds = (shareRows ?? []).map((row: { writing_id: string }) => row.writing_id)

    if (sharedWritingIds.length > 1) {
      const { data: sequenceWritings } = await admin
        .from("writings")
        .select("id, slug, updated_at")
        .in("id", sharedWritingIds)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })

      const sequence = sequenceWritings ?? []
      const idx = sequence.findIndex((w: { id: string }) => w.id === writing.id)

      if (idx !== -1) {
        sequencePosition = idx + 1
        sequenceTotal = sequence.length

        const previousWriting = sequence[idx - 1] as { id: string; slug: string | null } | undefined
        const nextWriting = sequence[idx + 1] as { id: string; slug: string | null } | undefined

        prevWritingId = previousWriting?.id ?? null
        nextWritingId = nextWriting?.id ?? null
        prevWritingHref = previousWriting ? buildWritingRouteHref("/shared", previousWriting) : null
        nextWritingHref = nextWriting ? buildWritingRouteHref("/shared", nextWriting) : null
      }
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
      prevWritingHref={prevWritingHref}
      nextWritingHref={nextWritingHref}
      sequencePosition={sequencePosition}
      sequenceTotal={sequenceTotal}
      canRespond={canRespond}
      backUrl="/shared"
    />
  )
}
