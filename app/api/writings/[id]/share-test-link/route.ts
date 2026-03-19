import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildTestLinkPath, createTestLinkToken, getTestLinkEmail, pickLatestPendingTestLink } from "@/lib/sharing/test-link"
import { createClient } from "@/lib/supabase/server"

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

const getCurrentUserId = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id ?? null
}

const verifyWritingOwnership = async (writingId: string, userId: string) => {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("writings")
    .select("id")
    .eq("id", writingId)
    .eq("author_id", userId)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>()

  if (error) {
    return { ok: false as const, error }
  }

  return { ok: true as const, exists: Boolean(data) }
}

const getActiveTestLink = async (writingId: string, userId: string) => {
  const markerEmail = getTestLinkEmail(writingId)
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("invitations")
    .select("token, email, status, created_at")
    .eq("inviter_id", userId)
    .eq("writing_id", writingId)
    .eq("email", markerEmail)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<Array<{ token: string; email: string; status: "pending" | "accepted" | "expired"; created_at: string }>>()

  if (error) {
    return { error }
  }

  return {
    error: null,
    invitation: pickLatestPendingTestLink(data ?? [], writingId),
  }
}

const revokeActiveTestLinks = async (writingId: string, userId: string) => {
  const markerEmail = getTestLinkEmail(writingId)
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "expired" })
    .eq("inviter_id", userId)
    .eq("writing_id", writingId)
    .eq("email", markerEmail)
    .eq("status", "pending")
    .select("id")

  if (error) {
    return { error, revokedCount: 0 }
  }

  return { error: null, revokedCount: data?.length ?? 0 }
}

const toAbsolutePreviewLink = (request: Request, token: string) =>
  new URL(buildTestLinkPath(token), request.url).toString()

export async function GET(request: Request, context: RouteContext) {
  const writingId = await parseWritingId(context)

  if (!writingId) {
    return jsonError(400, "INVALID_INPUT", "Invalid writing id.")
  }

  const userId = await getCurrentUserId()

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  const ownership = await verifyWritingOwnership(writingId, userId)

  if (!ownership.ok) {
    return jsonError(500, "DB_ERROR", ownership.error.message)
  }

  if (!ownership.exists) {
    return jsonError(404, "NOT_FOUND", "Writing not found.")
  }

  const activeLinkResult = await getActiveTestLink(writingId, userId)

  if (activeLinkResult.error) {
    return jsonError(500, "DB_ERROR", activeLinkResult.error.message)
  }

  if (!activeLinkResult.invitation) {
    return NextResponse.json(
      {
        data: {
          active: false,
          token: null,
          link: null,
          createdAt: null,
        },
        error: null,
      },
      { status: 200 },
    )
  }

  return NextResponse.json(
    {
      data: {
        active: true,
        token: activeLinkResult.invitation.token,
        link: toAbsolutePreviewLink(request, activeLinkResult.invitation.token),
        createdAt: activeLinkResult.invitation.created_at,
      },
      error: null,
    },
    { status: 200 },
  )
}

export async function POST(request: Request, context: RouteContext) {
  const writingId = await parseWritingId(context)

  if (!writingId) {
    return jsonError(400, "INVALID_INPUT", "Invalid writing id.")
  }

  const userId = await getCurrentUserId()

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  const ownership = await verifyWritingOwnership(writingId, userId)

  if (!ownership.ok) {
    return jsonError(500, "DB_ERROR", ownership.error.message)
  }

  if (!ownership.exists) {
    return jsonError(404, "NOT_FOUND", "Writing not found.")
  }

  const revokeResult = await revokeActiveTestLinks(writingId, userId)

  if (revokeResult.error) {
    return jsonError(500, "DB_ERROR", revokeResult.error.message)
  }

  const token = createTestLinkToken()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      inviter_id: userId,
      writing_id: writingId,
      email: getTestLinkEmail(writingId),
      token,
      status: "pending",
    })
    .select("token, created_at")
    .single<{ token: string; created_at: string }>()

  if (error) {
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json(
    {
      data: {
        active: true,
        token: data.token,
        link: toAbsolutePreviewLink(request, data.token),
        createdAt: data.created_at,
        replacedPrevious: revokeResult.revokedCount > 0,
      },
      error: null,
    },
    { status: 201 },
  )
}

export async function DELETE(_request: Request, context: RouteContext) {
  const writingId = await parseWritingId(context)

  if (!writingId) {
    return jsonError(400, "INVALID_INPUT", "Invalid writing id.")
  }

  const userId = await getCurrentUserId()

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  const ownership = await verifyWritingOwnership(writingId, userId)

  if (!ownership.ok) {
    return jsonError(500, "DB_ERROR", ownership.error.message)
  }

  if (!ownership.exists) {
    return jsonError(404, "NOT_FOUND", "Writing not found.")
  }

  const revokeResult = await revokeActiveTestLinks(writingId, userId)

  if (revokeResult.error) {
    return jsonError(500, "DB_ERROR", revokeResult.error.message)
  }

  return NextResponse.json(
    {
      data: {
        active: false,
        revoked: revokeResult.revokedCount > 0,
      },
      error: null,
    },
    { status: 200 },
  )
}
