import Link from "next/link"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { buildSharedWritingListItem } from "@/lib/sharing/writing-shares"

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}

export default async function SharedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const admin = createAdminClient()

  // Step 1: get writing IDs shared with this user
  const { data: shareRows } = await admin
    .from("writing_shares")
    .select("writing_id")
    .eq("shared_with_id", user.id)

  const writingIds = (shareRows ?? []).map((r: { writing_id: string }) => r.writing_id)

  // Step 2: fetch those writings (non-deleted) with author profile
  const writings =
    writingIds.length > 0
      ? await admin
          .from("writings")
          .select(
            "id, title, body_text, updated_at, profiles!author_id(username, display_name)",
          )
          .in("id", writingIds)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .then(({ data }) => data ?? [])
      : []

  type RawWritingRow = {
    id: string
    title: string | null
    body_text: string
    updated_at: string
    // PostgREST returns joined rows as array or single object depending on FK cardinality
    profiles:
      | { username: string; display_name: string }
      | { username: string; display_name: string }[]
      | null
  }

  const normalizeProfile = (
    profiles: RawWritingRow["profiles"],
  ): { username: string; display_name: string } | null => {
    if (!profiles) return null
    if (Array.isArray(profiles)) return profiles[0] ?? null
    return profiles
  }

  const items = (writings as RawWritingRow[]).map((w) =>
    buildSharedWritingListItem(
      { id: w.id, title: w.title, body_text: w.body_text, updated_at: w.updated_at },
      normalizeProfile(w.profiles),
    ),
  )

  return (
    <section id="shared" data-page="shared" className="min-h-[100dvh] flex-1 overflow-y-auto">
      <div
        id="shared-topbar"
        data-section="shared-topbar"
        className="SharedTopbar flex h-[46px] items-center border-b-[0.5px] border-border px-5 sm:px-6"
      >
        <p className="font-lora text-[15px] text-ink-2">Shared with me</p>
      </div>

      <div
        id="shared-list"
        data-section="shared-list"
        data-testid="shared-list"
        className="SharedList mx-auto max-w-[660px] px-5 py-6 sm:px-6 sm:py-8"
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="font-lora italic text-[15px] text-ink-3 max-w-[280px] leading-relaxed">
              Nothing has been shared with you yet.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/shared/${item.id}`}
                  className="block rounded-[10px] border-[0.5px] border-border bg-sb px-4 py-4 shadow-float transition-shadow hover:shadow-float-md sm:px-5"
                  data-testid="shared-writing-item"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-lora text-[15px] text-ink">
                        {item.title ?? "Untitled"}
                      </p>
                      {item.excerpt ? (
                        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-3">
                          {item.excerpt}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-[11px] text-ink-4">
                      {formatRelativeDate(item.updatedAt)}
                    </p>
                  </div>
                  {item.author ? (
                    <p className="mt-2 text-[11px] text-ink-4">
                      {item.author.displayName}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
