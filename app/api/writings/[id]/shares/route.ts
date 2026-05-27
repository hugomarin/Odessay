import { NextResponse } from "next/server"
import { z } from "zod"
import { createWebSharingService } from "@/lib/services/web-sharing-service"
import { parseSharePayload } from "@/lib/sharing/writing-shares"
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

// GET /api/writings/[id]/shares — list users with access (author only)
export async function GET(_req: Request, context: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.")

  const sharingService = await createWebSharingService({ userId })
  const result = await sharingService.listRecipients(parsed.data.id)

  if (result.error) {
    const status = result.error.code === "FORBIDDEN" ? 403 : result.error.code === "UNAUTHORIZED" ? 401 : 500
    return jsonError(status, result.error.code, result.error.message)
  }

  return NextResponse.json({ data: result.data, error: null })
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

  const payload = parseSharePayload(body)
  if (!payload) return jsonError(400, "INVALID_INPUT", shareBodySchema.safeParse(body).error?.message ?? "Invalid payload.")

  const sharingService = await createWebSharingService({ userId })
  const result = await sharingService.shareWriting({
    writingId: parsed.data.id,
    sharedWithUserId: payload.shared_with_id,
  })

  if (result.error) {
    const status =
      result.error.code === "UNAUTHORIZED"
        ? 401
        : result.error.code === "FORBIDDEN"
          ? 403
          : result.error.code === "ALREADY_SHARED"
            ? 409
            : result.error.code === "CANNOT_SHARE_WITH_SELF"
              ? 400
              : 500
    return jsonError(status, result.error.code, result.error.message)
  }

  return NextResponse.json({ data: result.data, error: null }, { status: 201 })
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

  const payload = parseSharePayload(body)
  if (!payload) return jsonError(400, "INVALID_INPUT", shareBodySchema.safeParse(body).error?.message ?? "Invalid payload.")

  const sharingService = await createWebSharingService({ userId })
  const result = await sharingService.revokeShare({
    writingId: parsed.data.id,
    sharedWithUserId: payload.shared_with_id,
  })

  if (result.error) {
    const status = result.error.code === "UNAUTHORIZED" ? 401 : result.error.code === "FORBIDDEN" ? 403 : 500
    return jsonError(status, result.error.code, result.error.message)
  }

  return new NextResponse(null, { status: 204 })
}
