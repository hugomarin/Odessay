// class: list (default), manifest (?fields=manifest), detail batch (?ids=...)
// Presupuesto: ≤ 50 kB ungzip total para ≤ 200 writings en modo list.
// Modo manifest: solo id, updated_at, content_hash, deleted_at, version — sin body.
// Modo batch (?ids): devuelve el writing completo (con body_json/body_text) para
// los ids solicitados. El cliente que necesite un writing concreto también puede
// llamar GET /api/writings/:id (class: detail).

import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

const WRITING_LIST_SELECT =
  "id, author_id, title, slug, status, artifact_type, visibility, parent_id, correspondence_id, version, sync_status, deleted_at, created_at, updated_at, content_updated_at, metadata_updated_at, content_hash"

const WRITING_MANIFEST_SELECT = "id, updated_at, content_hash, deleted_at, version"

const WRITING_DETAIL_BATCH_SELECT = `${WRITING_LIST_SELECT}, body_json, body_text`

const MAX_BATCH_IDS = 200

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

  const { searchParams } = new URL(request.url)
  const fields = searchParams.get("fields")
  const idsParam = searchParams.get("ids")

  if (fields === "manifest") {
    const { data, error } = await supabase
      .from("writings")
      .select(WRITING_MANIFEST_SELECT)
      .eq("author_id", userId)
      .order("updated_at", { ascending: false })

    if (error) {
      return jsonError(500, "DB_ERROR", error.message)
    }

    return NextResponse.json({ data, error: null }, { status: 200 })
  }

  if (idsParam !== null) {
    const rawIds = idsParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)

    const parsed = z.array(z.string().uuid()).max(MAX_BATCH_IDS).safeParse(rawIds)

    if (!parsed.success) {
      return jsonError(400, "INVALID_INPUT", parsed.error.message)
    }

    const { data, error } = await supabase
      .from("writings")
      .select(WRITING_DETAIL_BATCH_SELECT)
      .eq("author_id", userId)
      .in("id", parsed.data)

    if (error) {
      return jsonError(500, "DB_ERROR", error.message)
    }

    return NextResponse.json({ data, error: null }, { status: 200 })
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
