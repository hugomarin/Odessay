// class: list
// Presupuesto: ≤ 50 kB ungzip total para ≤ 200 writings.
// No incluye body_json ni body_text. El cliente que necesite el body de un
// writing concreto llama GET /api/writings/:id (class: detail).
// Variante opt-in documentada pero no implementada:
//   GET /api/writings?include=body

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

const WRITING_LIST_SELECT =
  "id, author_id, title, slug, status, artifact_type, visibility, parent_id, correspondence_id, version, sync_status, deleted_at, created_at, updated_at, content_updated_at, metadata_updated_at, content_hash"

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

export async function GET(request: Request) {
  const { userId } = await getCurrentUserFromRequest(request)
  const supabase = createAdminClient()

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  const query = supabase
    .from("writings")
    .select(WRITING_LIST_SELECT)
    .eq("author_id", userId)
    .order("updated_at", { ascending: false })
  const { data, error } = await query

  if (error) {
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 200 })
}
