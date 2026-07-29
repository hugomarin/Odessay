import { NextResponse } from "next/server"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) return NextResponse.json({ data: null, error: { code: "UNAUTHORIZED", message: "No active session." } }, { status: 401 })
  const url = new URL(request.url)
  const limit = Math.min(51, Math.max(1, Number(url.searchParams.get("limit")) || 26))
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0)
  const supabase = await createClient()
  const { data, error } = await supabase.from("writings")
    .select("id,author_id,title,slug,status,artifact_type,visibility,parent_id,correspondence_id,version,deleted_at,created_at,updated_at")
    .eq("author_id", userId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).range(offset, offset + limit - 1)
  return error
    ? NextResponse.json({ data: null, error: { code: "DB_ERROR", message: error.message } }, { status: 500 })
    : NextResponse.json({ data: data ?? [], error: null })
}
