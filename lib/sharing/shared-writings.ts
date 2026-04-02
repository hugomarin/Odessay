import { createAdminClient } from "@/lib/supabase/admin"
import { buildSharedWritingListItem, type SharedWritingListItem } from "@/lib/sharing/writing-shares"

type RawWritingRow = {
  id: string
  title: string | null
  body_text: string
  updated_at: string
  profiles:
    | { username: string; display_name: string }
    | { username: string; display_name: string }[]
    | null
}

const normalizeProfile = (
  profiles: RawWritingRow["profiles"],
): { username: string; display_name: string } | null => {
  if (!profiles) {
    return null
  }

  if (Array.isArray(profiles)) {
    return profiles[0] ?? null
  }

  return profiles
}

export async function listSharedWritingsForUser(userId: string): Promise<SharedWritingListItem[]> {
  const admin = createAdminClient()

  const { data: shareRows, error: shareError } = await admin
    .from("writing_shares")
    .select("writing_id")
    .eq("shared_with_id", userId)

  if (shareError) {
    throw new Error(shareError.message)
  }

  const writingIds = (shareRows ?? []).map((row: { writing_id: string }) => row.writing_id)

  if (writingIds.length === 0) {
    return []
  }

  const { data: writings, error: writingsError } = await admin
    .from("writings")
    .select("id, title, body_text, updated_at, profiles!author_id(username, display_name)")
    .in("id", writingIds)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  if (writingsError) {
    throw new Error(writingsError.message)
  }

  return (writings ?? []).map((writing) =>
    buildSharedWritingListItem(
      {
        id: writing.id,
        title: writing.title,
        body_text: writing.body_text,
        updated_at: writing.updated_at,
      },
      normalizeProfile((writing as RawWritingRow).profiles),
    ),
  )
}
