import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

type RouteContext = { params: Promise<{ id: string }> }

const paramsSchema = z.object({ id: z.string().uuid() })
const shareBodySchema = z.object({ shared_with_id: z.string().uuid() })

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

const getCurrentUserId = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

const verifyWritingOwnership = async (writingId: string, userId: string) => {
  const admin = createAdminClient()
  const { data } = await admin
    .from("writings")
    .select("id, visibility")
    .eq("id", writingId)
    .eq("author_id", userId)
    .is("deleted_at", null)
    .single()
  return data as { id: string; visibility: string } | null
}

// GET /api/writings/[id]/shares — list users with access (author only)
export async function GET(_req: Request, context: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.")

  const writing = await verifyWritingOwnership(parsed.data.id, userId)
  if (!writing) return jsonError(403, "FORBIDDEN", "Writing not found or access denied.")

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("writing_shares")
    .select("id, shared_with_id, can_respond, created_at, profiles!shared_with_id(username, display_name)")
    .eq("writing_id", parsed.data.id)
    .order("created_at", { ascending: true })

  if (error) return jsonError(500, "DB_ERROR", error.message)

  return NextResponse.json({ data, error: null })
}

// POST /api/writings/[id]/shares — share with a user
export async function POST(req: Request, context: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.")

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(400, "INVALID_INPUT", "Request body must be JSON.")
  }

  const bodyParsed = shareBodySchema.safeParse(body)
  if (!bodyParsed.success) return jsonError(400, "INVALID_INPUT", bodyParsed.error.message)

  if (bodyParsed.data.shared_with_id === userId) {
    return jsonError(400, "CANNOT_SHARE_WITH_SELF", "Cannot share a writing with yourself.")
  }

  const writing = await verifyWritingOwnership(parsed.data.id, userId)
  if (!writing) return jsonError(403, "FORBIDDEN", "Writing not found or access denied.")

  const admin = createAdminClient()

  // Auto-upgrade visibility to 'shared' if currently private
  if (writing.visibility === "private") {
    const { error: visErr } = await admin
      .from("writings")
      .update({ visibility: "shared" })
      .eq("id", parsed.data.id)
    if (visErr) return jsonError(500, "DB_ERROR", visErr.message)
  }

  const { data, error } = await admin
    .from("writing_shares")
    .insert({
      writing_id: parsed.data.id,
      shared_with_id: bodyParsed.data.shared_with_id,
      can_respond: true,
    })
    .select("id, shared_with_id, can_respond, created_at, profiles!shared_with_id(username, display_name)")
    .single()

  if (error) {
    if (error.code === "23505") {
      return jsonError(409, "ALREADY_SHARED", "Writing already shared with this user.")
    }
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 201 })
}

// DELETE /api/writings/[id]/shares — revoke access for a user
export async function DELETE(req: Request, context: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.")

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError(400, "INVALID_INPUT", "Request body must be JSON.")
  }

  const bodyParsed = shareBodySchema.safeParse(body)
  if (!bodyParsed.success) return jsonError(400, "INVALID_INPUT", bodyParsed.error.message)

  const writing = await verifyWritingOwnership(parsed.data.id, userId)
  if (!writing) return jsonError(403, "FORBIDDEN", "Writing not found or access denied.")

  const admin = createAdminClient()
  const { error } = await admin
    .from("writing_shares")
    .delete()
    .eq("writing_id", parsed.data.id)
    .eq("shared_with_id", bodyParsed.data.shared_with_id)

  if (error) return jsonError(500, "DB_ERROR", error.message)

  return new NextResponse(null, { status: 204 })
}
