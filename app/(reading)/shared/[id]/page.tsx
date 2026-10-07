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

type SessionClient = Awaited<ReturnType<typeof createClient>>

type WritingSummaryRow = {
  id: string
  title: string | null
}

type WritingDetailRow = {
  id: string
  title: string | null
  body_json: JSONContent | null
  body_text: string
  updated_at: string
  profiles: { username: string; display_name: string } | { username: string; display_name: string }[] | null
}

type WritingLifecycle = "owner" | "share"

type ResolvedWritingSummary = WritingSummaryRow & { via: WritingLifecycle }

function normalizeProfile(
  profiles: WritingDetailRow["profiles"],
): { username: string; display_name: string } | null {
  if (!profiles) return null
  if (Array.isArray(profiles)) return profiles[0] ?? null
  return profiles
}

// ODE-669: la resolución autoriza con la sesión (RLS real) y el share del
// viewer, y solo la trae la proyección mínima. Ningún candidato perdedor
// transfiere body_json/body_text; el detalle se pide por el UUID ganador.
const SUMMARY_SELECT = "id, title"
const SHARED_SUMMARY_SELECT = `${SUMMARY_SELECT}, writing_shares!inner(writing_id)`
const DETAIL_SELECT =
  "id, title, body_json, body_text, updated_at, profiles!author_id(username, display_name)"
const SHARED_DETAIL_SELECT = `${DETAIL_SELECT}, writing_shares!inner(writing_id)`

/**
 * Resuelve el UUID/slug a un único candidato autorizado sin traer cuerpos:
 * primero el written del propio viewer y, si no, el candidato compartido
 * legible más nuevo. La autorización no se reimplementa: la fila de share del
 * viewer (`writing_shares!inner`) y RLS (`can_read_writing`) son el oracle; el
 * público ajeno sin share y el privado con share viejo no pasan.
 *
 * Un identificador con forma de UUID se resuelve solo por id: si el UUID no
 * existe o está denegado no se reintenta como slug.
 */
async function resolveSharedWriting(
  supabase: SessionClient,
  identifier: string,
  viewerId: string,
): Promise<ResolvedWritingSummary | null> {
  const byId = isUuidLikeWritingIdentifier(identifier)

  const ownerQuery = supabase
    .from("writings")
    .select(SUMMARY_SELECT)
    .eq("author_id", viewerId)
    .is("deleted_at", null)

  const { data: ownerRow, error: ownerError } = await (byId
    ? ownerQuery.eq("id", identifier)
    : ownerQuery.eq("slug", identifier)
  )
    .limit(1)
    .maybeSingle()

  if (ownerError) {
    throw ownerError
  }

  if (ownerRow) {
    return { id: ownerRow.id, title: ownerRow.title, via: "owner" }
  }

  // El slug es único por autor, así que puede haber varios candidatos para el
  // mismo slug (ODE-659). El filtro del viewer es el grant vigente; el orden
  // elige al más nuevo de los legibles y `.limit(1)` evita traer al resto.
  const sharedQuery = supabase
    .from("writings")
    .select(SHARED_SUMMARY_SELECT)
    .eq("writing_shares.shared_with_id", viewerId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  const { data: sharedRow, error: sharedError } = await (byId
    ? sharedQuery.eq("id", identifier)
    : sharedQuery.eq("slug", identifier)
  )
    .limit(1)
    .maybeSingle()

  if (sharedError) {
    throw sharedError
  }

  if (!sharedRow) {
    return null
  }

  return { id: sharedRow.id, title: sharedRow.title, via: "share" }
}

/**
 * Carga el detalle solo del UUID ya resuelto y vuelve a comprobar el grant
 * (relectura bajo RLS + fila de share del viewer). Si el share se revocó entre
 * el summary y este paso, no hay fila: TOCTOU de revocación cerrado.
 */
async function loadAuthorizedDetail(
  supabase: SessionClient,
  resolved: ResolvedWritingSummary,
  viewerId: string,
): Promise<WritingDetailRow | null> {
  if (resolved.via === "owner") {
    const { data, error } = await supabase
      .from("writings")
      .select(DETAIL_SELECT)
      .eq("id", resolved.id)
      .eq("author_id", viewerId)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) {
      throw error
    }

    return (data as WritingDetailRow | null) ?? null
  }

  const { data, error } = await supabase
    .from("writings")
    .select(SHARED_DETAIL_SELECT)
    .eq("id", resolved.id)
    .eq("writing_shares.shared_with_id", viewerId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as WritingDetailRow | null) ?? null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: identifier } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Solo el título autorizado: el summary no trae body y sin sesión no hay
  // candidato legible que consultar.
  const writing = user ? await resolveSharedWriting(supabase, identifier, user.id) : null

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

  const resolved = await resolveSharedWriting(supabase, identifier, user.id)

  if (!resolved) notFound()

  // La URL canónica de `/shared` es el id (ODE-659): un slug viejo que
  // resuelve para el viewer redirige al id sin cargar el cuerpo.
  if (identifier !== resolved.id) {
    redirect(`/shared/${resolved.id}`)
  }

  const writing = await loadAuthorizedDetail(supabase, resolved, user.id)

  if (!writing) notFound()

  const isAuthor = resolved.via === "owner"

  const profile = normalizeProfile(writing.profiles)

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
