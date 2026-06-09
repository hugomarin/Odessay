import { NextResponse } from "next/server"
import { z } from "zod"
import { createWebSharingService } from "@/lib/services/web-sharing-service"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

const MAX_IDS = 50

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// GET /api/writings/shares?ids=uuid1,uuid2,... — batch list shares for multiple writings
export async function GET(req: Request) {
  const { userId } = await getCurrentUserFromRequest(req)
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

  const sharingService = await createWebSharingService({ userId })
  const result = await sharingService.listRecipientPreviews(ids)

  if (result.error) {
    return jsonError(result.error.code === "INVALID_INPUT" ? 400 : 500, result.error.code, result.error.message)
  }

  return NextResponse.json({ data: result.data, error: null })
}
