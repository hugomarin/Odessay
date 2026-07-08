import { NextResponse } from "next/server"
import { z } from "zod"
import { createWebSharingService } from "@/lib/services/web-sharing-service"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"

type RouteContext = {
  params: Promise<{ id: string }>
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

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

const parseWritingId = async (context: RouteContext) => {
  const params = await context.params
  const parsed = paramsSchema.safeParse(params)

  return parsed.success ? parsed.data.id : null
}

export async function GET(request: Request, context: RouteContext) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const writingId = await parseWritingId(context)

  if (!writingId) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Invalid writing id."), request)
  }

  const { userId } = await getCurrentUserFromRequest(request)

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request)
  }

  const sharingService = await createWebSharingService({ userId, requestUrl: request.url })
  const result = await sharingService.getPreviewLink(writingId)

  if (result.error) {
    const status =
      result.error.code === "UNAUTHORIZED" ? 401 : result.error.code === "NOT_FOUND" ? 404 : 500
    return withCorsHeaders(jsonError(status, result.error.code, result.error.message), request)
  }

  return withCorsHeaders(NextResponse.json({ data: result.data, error: null }, { status: 200 }), request)
}

export async function POST(request: Request, context: RouteContext) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const writingId = await parseWritingId(context)

  if (!writingId) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Invalid writing id."), request)
  }

  const { userId } = await getCurrentUserFromRequest(request)

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request)
  }

  const sharingService = await createWebSharingService({ userId, requestUrl: request.url })
  const result = await sharingService.rotatePreviewLink(writingId)

  if (result.error) {
    const status =
      result.error.code === "UNAUTHORIZED" ? 401 : result.error.code === "NOT_FOUND" ? 404 : 500
    return withCorsHeaders(jsonError(status, result.error.code, result.error.message), request)
  }

  return withCorsHeaders(NextResponse.json({ data: result.data, error: null }, { status: 201 }), request)
}

export async function DELETE(request: Request, context: RouteContext) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight

  const writingId = await parseWritingId(context)

  if (!writingId) {
    return withCorsHeaders(jsonError(400, "INVALID_INPUT", "Invalid writing id."), request)
  }

  const { userId } = await getCurrentUserFromRequest(request)

  if (!userId) {
    return withCorsHeaders(jsonError(401, "UNAUTHORIZED", "No active session."), request)
  }

  const sharingService = await createWebSharingService({ userId, requestUrl: request.url })
  const result = await sharingService.revokePreviewLink(writingId)

  if (result.error) {
    const status =
      result.error.code === "UNAUTHORIZED" ? 401 : result.error.code === "NOT_FOUND" ? 404 : 500
    return withCorsHeaders(jsonError(status, result.error.code, result.error.message), request)
  }

  return withCorsHeaders(NextResponse.json({ data: result.data, error: null }, { status: 200 }), request)
}

export async function OPTIONS(request: Request) {
  const preflight = handleCorsPreflight(request)
  if (preflight) return preflight
  return withCorsHeaders(new Response(null, { status: 204 }), request)
}
