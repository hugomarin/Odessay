import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { AuthorHeader } from "@/components/public/author-header"
import { PublicWritingList } from "@/components/public/public-writing-list"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type PageProps = {
  params: Promise<{ username: string }>
}

type WritingRow = {
  id: string
  title: string | null
  body_text: string
  updated_at: string
  visibility: "private" | "shared" | "public"
  status: "draft" | "finished"
  slug: string | null
  version: number
}

type CollectionRow = {
  id: string
  name: string
}

type WritingCollectionRow = {
  collection_id: string
  writing_id: string
}

function truncateOgDescription(input: string | null, fallback: string): string {
  if (!input) return fallback
  const trimmed = input.trim()
  if (!trimmed) return fallback
  if (trimmed.length <= 160) return trimmed
  return `${trimmed.slice(0, 157)}...`
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, bio")
    .eq("username", username)
    .maybeSingle()

  if (!profile) {
    return {
      title: "Odessay",
    }
  }

  const displayName = profile.display_name
  const description = truncateOgDescription(profile.bio, "Escritura epistolar en Odessay.")

  return {
    title: `${displayName} — Odessay`,
    description,
    openGraph: {
      title: `${displayName} — Odessay`,
      description,
    },
  }
}

export default async function PublicAuthorPage({ params }: PageProps) {
  const { username } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await admin
    .from("profiles")
    .select("id, username, display_name, bio")
    .eq("username", username)
    .maybeSingle()

  if (!profile) notFound()

  const isOwner = profile.id === user?.id

  let writingsQuery = admin
    .from("writings")
    .select("id, title, body_text, updated_at, visibility, status, slug, version")
    .eq("author_id", profile.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  if (!isOwner) {
    writingsQuery = writingsQuery.eq("visibility", "public")
  }

  const [{ data: writingsData, error: writingsError }, { data: collectionsData, error: collectionsError }, { data: publicWritingsData, error: publicWritingsError }] = await Promise.all([
    writingsQuery,
    admin
      .from("collections")
      .select("id, name")
      .eq("owner_id", profile.id)
      .eq("visibility", "public")
      .order("updated_at", { ascending: false }),
    admin
      .from("writings")
      .select("id")
      .eq("author_id", profile.id)
      .eq("visibility", "public")
      .is("deleted_at", null),
  ])

  if (writingsError || collectionsError || publicWritingsError) {
    throw new Error(
      writingsError?.message ??
        collectionsError?.message ??
        publicWritingsError?.message ??
        "Failed to load public author space.",
    )
  }

  const writings = (writingsData ?? []) as WritingRow[]
  const collections = (collectionsData ?? []) as CollectionRow[]
  const publicWritingIds = (publicWritingsData ?? []).map((row: { id: string }) => row.id)
  const collectionIds = collections.map((collection) => collection.id)

  let writingCollections: WritingCollectionRow[] = []
  if (collectionIds.length > 0 && publicWritingIds.length > 0) {
    const { data: writingCollectionsData, error: writingCollectionsError } = await admin
      .from("writing_collections")
      .select("collection_id, writing_id")
      .in("collection_id", collectionIds)
      .in("writing_id", publicWritingIds)

    if (writingCollectionsError) {
      throw new Error(writingCollectionsError.message)
    }

    writingCollections = (writingCollectionsData ?? []) as WritingCollectionRow[]
  }

  const countsByCollection = new Map<string, number>()
  for (const row of writingCollections) {
    countsByCollection.set(row.collection_id, (countsByCollection.get(row.collection_id) ?? 0) + 1)
  }

  const collectionItems = collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    publicWritingsCount: countsByCollection.get(collection.id) ?? 0,
  }))

  return (
    <section id="public-author-page" data-page="public-author-page" className="PublicAuthorPage flex min-h-screen flex-col">
      <header className="border-b-[0.5px] border-border">
        <div className="mx-auto flex h-[46px] w-full max-w-[720px] items-center justify-between px-6">
          <Link href="/" className="font-lora text-[17px] text-ink">
            Odessay
          </Link>
          <Link href={user ? "/desk" : "/login"} className="text-[13px] font-medium text-ink-3 transition-colors hover:text-ink-2">
            {user ? "Desk" : "Log in"}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pb-16 pt-10 sm:px-6 sm:pt-12">
        <div className="flex flex-col gap-12">
          <AuthorHeader
            profile={{
              displayName: profile.display_name,
              username: profile.username,
              bio: profile.bio,
            }}
          />

          <PublicWritingList
            username={profile.username}
            isOwner={isOwner}
            writings={writings.map((writing) => ({
              id: writing.id,
              title: writing.title,
              bodyText: writing.body_text,
              updatedAt: writing.updated_at,
              visibility: writing.visibility,
              status: writing.status,
              slug: writing.slug,
              version: writing.version,
            }))}
            collections={collectionItems}
          />
        </div>
      </main>
    </section>
  )
}
