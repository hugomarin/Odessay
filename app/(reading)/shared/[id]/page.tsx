import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import type { JSONContent } from "@tiptap/core"
import { AddToMyWritingsButton } from "@/components/reading/add-to-my-writings-button"
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

async function resolveSharedWriting(identifier: string, viewerId: string | null): Promise<WritingRow | null> {
  const admin = createAdminClient()

  if (isUuidLikeWritingIdentifier(identifier)) {
    const { data, error } = await admin
      .from("writings")
      .select(WRITING_SELECT)
      .eq("id", identifier)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (data) {
      const writing = data as WritingRow
      return (await canViewerReadWriting(admin, writing, viewerId)) ? writing : null
    }
  }

  // El slug es único por autor, así que puede haber varios candidatos para el
  // mismo slug (ODE-659). Se conservan solo los legibles por el viewer (misma
  // regla D-1) y la elección es determinista: primero el suyo y, si no, el más
  // reciente. Nunca un maybeSingle que reviente con dos filas.
  const { data, error } = await admin
    .from("writings")
    .select(WRITING_SELECT)
    .eq("slug", identifier)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  if (error) {
    throw error
  }

  const readable: WritingRow[] = []
  for (const candidate of (data ?? []) as WritingRow[]) {
    if (await canViewerReadWriting(admin, candidate, viewerId)) {
      readable.push(candidate)
    }
  }

  return readable.find((candidate) => candidate.author_id === viewerId) ?? readable[0] ?? null
}

/**
 * Regla D-1 del camino service-role (intersección): autor, o fila de share
 * `can_read_writing` (la misma regla que RLS). Un público ajeno sin share no
 * abre por `/shared`, y un privado con share viejo tampoco: el exceso de
 * confianza en la fila de share es la fuga F1.
 */
async function canViewerReadWriting(
  admin: ReturnType<typeof createAdminClient>,
  writing: WritingRow,
  viewerId: string | null,
): Promise<boolean> {
  if (!viewerId) return false
  if (writing.author_id === viewerId) return true

  const { data: shareRow, error: shareError } = await admin
    .from("writing_shares")
    .select("id")
    .eq("writing_id", writing.id)
    .eq("shared_with_id", viewerId)
    .maybeSingle()

  if (shareError) {
    throw shareError
  }

  if (!shareRow) return false

  const { data: canRead, error: canReadError } = await admin.rpc("can_read_writing", {
    target_writing_id: writing.id,
    viewer_id: viewerId,
  })

  if (canReadError) {
    throw canReadError
  }

  return canRead === true
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: identifier } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const writing = await resolveSharedWriting(identifier, user?.id ?? null)

  return {
    title: writing?.title ? `${writing.title} — Artifact Studio` : "Reading — Artifact Studio",
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

  const writing = await resolveSharedWriting(identifier, user.id)

  if (!writing) notFound()

  const isAuthor = writing.author_id === user.id

  // La URL canónica de `/shared` es el id (ODE-659): un slug viejo que
  // resuelve para el viewer redirige al id.
  if (identifier !== writing.id) {
    redirect(`/shared/${writing.id}`)
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
        .in("visibility", ["shared", "public"])
        .neq("author_id", user.id)
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
      extraActionNode={<AddToMyWritingsButton source="shared" writingId={writing.id} />}
    />
  )
}

export function generateStaticParams() {
  return [{ id: "placeholder" }]
}
