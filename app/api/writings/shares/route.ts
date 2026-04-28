import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

const MAX_IDS = 50

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

const getCurrentUserId = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

type RecipientPreview = {
  username: string
  displayName: string
}

// GET /api/writings/shares?ids=uuid1,uuid2,... — batch list shares for multiple writings
export async function GET(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const { searchParams } = new URL(req.url)
  const idsParam = searchParams.get("ids")

  if (!idsParam || idsParam.trim().length === 0) {
    return jsonError(400, "INVALID_INPUT", "Missing 'ids' query parameter.")
  }

  const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean)

  if (ids.length === 0) {
    return jsonError(400, "INVALID_INPUT", "No valid IDs provided.")
  }

  if (ids.length > MAX_IDS) {
    return jsonError(400, "INVALID_INPUT", `Maximum ${MAX_IDS} IDs allowed. Got ${ids.length}.`)
  }

  const idSchema = z.string().uuid()
  for (const id of ids) {
    if (!idSchema.safeParse(id).success) {
      return jsonError(400, "INVALID_INPUT", `Invalid UUID format: ${id}`)
    }
  }

  const admin = createAdminClient()

  // 1. Verify ownership in batch: which of these writings belong to the user?
  const { data: ownedWritings, error: ownershipError } = await admin
    .from("writings")
    .select("id")
    .in("id", ids)
    .eq("author_id", userId)
    .is("deleted_at", null)

  if (ownershipError) {
    return jsonError(500, "DB_ERROR", ownershipError.message)
  }

  const ownedIds = new Set((ownedWritings ?? []).map((w) => w.id))

  if (ownedIds.size === 0) {
    const emptyResult: Record<string, RecipientPreview[]> = {}
    for (const id of ids) {
      emptyResult[id] = []
    }
    return NextResponse.json({ data: emptyResult, error: null })
  }

  // 2. Fetch shares in batch for owned writings only
  const { data: shares, error: sharesError } = await admin
    .from("writing_shares")
    .select("id, writing_id, shared_with_id, can_respond, created_at, profiles!shared_with_id(username, display_name)")
    .in("writing_id", Array.from(ownedIds))
    .order("created_at", { ascending: true })

  if (sharesError) {
    return jsonError(500, "DB_ERROR", sharesError.message)
  }

  const result: Record<string, RecipientPreview[]> = {}

  for (const id of ids) {
    result[id] = []
  }

  for (const share of shares ?? []) {
    const writingId = share.writing_id as string

    const rawProfile = (share.profiles ?? null) as
      | { username: string; display_name: string }
      | { username: string; display_name: string }[]
      | null

    const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile

    if (!profile) continue

    if (!result[writingId]) {
      result[writingId] = []
    }

    result[writingId].push({
      username: profile.username,
      displayName: profile.display_name,
    })
  }

  return NextResponse.json({ data: result, error: null })
}
