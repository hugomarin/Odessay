import { NextResponse } from "next/server"
import { z } from "zod"
import { createWebSharingService } from "@/lib/services/web-sharing-service"
import { parseSharePayload } from "@/lib/sharing/writing-shares"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"

type RouteContext = { params: Promise<{ id: string }> }

const paramsSchema = z.object({ id: z.string().uuid() })
const shareBodySchema = z.object({ shared_with_id: z.string().uuid() })

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// GET /api/writings/[id]/shares — list users with access (author only)
export async function GET(req: Request, context: RouteContext) {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(req)
  if (!userId) return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), req)

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return withCorsHeaders(jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID."), req)

  const sharingService = await createWebSharingService({ userId })
  const result = await sharingService.listRecipients(parsed.data.id)

  if (result.error) {
    const status = result.error.code === "FORBIDDEN" ? 403 : result.error.code === "UNAUTHORIZED" ? 401 : 500
    return withCorsHeaders(jsonError(status, result.error.code, result.error.message), req)
  }

  return withCorsHeaders(NextResponse.json({ data: result.data, error: null }), req)
}

// POST /api/writings/[id]/shares — share with a user
export async function POST(req: Request, context: RouteContext) {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(req)
  if (!userId) return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), req)

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return withCorsHeaders(jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID."), req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Request body must be JSON."), req)
  }

  const payload = parseSharePayload(body)
  if (!payload) return withCorsHeaders(jsonError(400, "INVALID_INPUT", shareBodySchema.safeParse(body).error?.message ?? "Invalid payload."), req)

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
    return withCorsHeaders(jsonError(status, result.error.code, result.error.message), req)
  }

  return withCorsHeaders(NextResponse.json({ data: result.data, error: null }, { status: 201 }), req)
}

// DELETE /api/writings/[id]/shares — revoke access for a user
export async function DELETE(req: Request, context: RouteContext) {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  const { userId } = await getCurrentUserFromRequest(req)
  if (!userId) return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), req)

  const params = await context.params
  const parsed = paramsSchema.safeParse(params)
  if (!parsed.success) return withCorsHeaders(jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID."), req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Request body must be JSON."), req)
  }

  const payload = parseSharePayload(body)
  if (!payload) return withCorsHeaders(jsonError(400, "INVALID_INPUT", shareBodySchema.safeParse(body).error?.message ?? "Invalid payload."), req)

  const sharingService = await createWebSharingService({ userId })
  const result = await sharingService.revokeShare({
    writingId: parsed.data.id,
    sharedWithUserId: payload.shared_with_id,
  })

  if (result.error) {
    const status = result.error.code === "UNAUTHORIZED" ? 401 : result.error.code === "FORBIDDEN" ? 403 : 500
    return withCorsHeaders(jsonError(status, result.error.code, result.error.message), req)
  }

  return withCorsHeaders(new NextResponse(null, { status: 204 }), req)
}

export async function OPTIONS(req: Request) {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), req)
}
