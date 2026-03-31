import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { parseUserSearchQuery } from "@/lib/sharing/writing-shares"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// GET /api/users/search?q=... — search users by username or display_name
// Returns only id, username, display_name — never email.
export async function GET(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const url = new URL(req.url)
  const q = parseUserSearchQuery(url.searchParams.get("q"))

  if (!q) {
    return jsonError(400, "INVALID_QUERY", "Query must be at least 2 characters.")
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq("id", user.id)
    .limit(10)

  if (error) return jsonError(500, "DB_ERROR", error.message)

  return NextResponse.json({ data: data ?? [], error: null })
}
