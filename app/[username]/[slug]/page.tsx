import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ReadingView } from "@/components/reading/reading-view"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type PageProps = {
  params: Promise<{ username: string; slug: string }>
}

function truncateOgDescription(input: string | null, fallback: string): string {
  if (!input) return fallback
  const trimmed = input.trim()
  if (!trimmed) return fallback
  if (trimmed.length <= 160) return trimmed
  return `${trimmed.slice(0, 157)}...`
}

function buildInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username, slug } = await params
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("username", username)
    .maybeSingle()

  if (!profile) {
    return {
      title: "Odessay",
    }
  }

  const { data: writing } = await admin
    .from("writings")
    .select("title, body_text")
    .eq("author_id", profile.id)
    .eq("slug", slug)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .maybeSingle()

  if (!writing) {
    return {
      title: "Odessay",
    }
  }

  const title = `${writing.title ?? "Untitled"} — ${profile.display_name} — Odessay`
  const description = truncateOgDescription(writing.body_text, "Escritura epistolar en Odessay.")

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      authors: [profile.display_name],
    },
  }
}

export default async function PublicWritingPage({ params }: PageProps) {
  const { username, slug } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .eq("username", username)
    .maybeSingle()

  if (!profile) notFound()

  const { data: writing } = await admin
    .from("writings")
    .select("id, title, body_json, body_text, updated_at")
    .eq("author_id", profile.id)
    .eq("slug", slug)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .maybeSingle()

  if (!writing) notFound()

  const responseHref = user
    ? `/write?reply_to=${writing.id}`
    : `/login?next=${encodeURIComponent(`/write?reply_to=${writing.id}`)}`

  const accountHref = user ? "/desk" : "/login"
  const accountLabel = user ? buildInitials(profile.display_name) : "Log in"

  return (
    <ReadingView
      writing={{
        id: writing.id,
        title: writing.title,
        bodyJson: writing.body_json,
        bodyText: writing.body_text,
        updatedAt: writing.updated_at,
      }}
      author={{
        displayName: profile.display_name,
        username: profile.username,
      }}
      canRespond
      backUrl={`/${profile.username}`}
      isAuthenticated={Boolean(user)}
      chromeMode="public"
      publicHeader={{
        logoHref: "/",
        accountHref,
        accountLabel,
      }}
      respondHref={responseHref}
    />
  )
}

export function generateStaticParams() {
  return [{ username: "placeholder", slug: "placeholder" }]
}
