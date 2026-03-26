import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json(
    {
      data: null,
      error: {
        code,
        message,
      },
    },
    { status },
  )

async function getCurrentUserId() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { userId: user?.id ?? null }
}

export async function GET() {
  const { userId } = await getCurrentUserId()
  const supabase = createAdminClient()

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  const { data, error } = await supabase
    .from("writings")
    .select(
      "id, author_id, title, body_json, body_text, slug, status, visibility, parent_id, correspondence_id, version, sync_status, deleted_at, created_at, updated_at",
    )
    .eq("author_id", userId)
    .order("updated_at", { ascending: false })

  if (error) {
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 200 })
}
