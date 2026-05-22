import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { syncMarginsFromBodyJson } from "@/lib/margins/margins"

const annotatePayloadSchema = z.object({
  body_json: z.record(z.string(), z.unknown()),
  body_text: z.string(),
  body_markdown: z.string().optional(),
})

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, "INVALID_INPUT", "Invalid JSON body.")
  }

  const parsed = annotatePayloadSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message)
  }

  const admin = createAdminClient()
  const { id } = await context.params

  const { data: currentWriting, error: currentError } = await admin
    .from("writings")
    .select("id, version")
    .eq("id", id)
    .eq("author_id", user.id)
    .maybeSingle()

  if (currentError) {
    return jsonError(500, "DB_ERROR", currentError.message)
  }

  if (!currentWriting) {
    return jsonError(404, "NOT_FOUND", "Writing not found.")
  }

  const nextUpdatedAt = new Date().toISOString()
  const { data: updatedWriting, error: updateError } = await admin
    .from("writings")
    .update({
      body_json: parsed.data.body_json,
      body_text: parsed.data.body_text,
      updated_at: nextUpdatedAt,
      version: (currentWriting.version ?? 0) + 1,
    })
    .eq("id", id)
    .eq("author_id", user.id)
    .select("id, body_json, body_text, updated_at, version")
    .single()

  if (updateError) {
    return jsonError(500, "DB_ERROR", updateError.message)
  }

  const margins = await syncMarginsFromBodyJson(admin, {
    bodyJson: parsed.data.body_json,
    writingId: id,
    readerId: user.id,
  }).catch((error: { message?: string }) => {
    throw new Error(error.message ?? "Failed to sync margins.")
  })

  return NextResponse.json(
    {
      data: {
        writing: updatedWriting,
        margins,
        body_markdown: parsed.data.body_markdown ?? null,
      },
      error: null,
    },
    { status: 200 },
  )
}
