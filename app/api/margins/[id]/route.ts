import { NextResponse } from "next/server"
import { z } from "zod"
import { isLegacyMarginsSchemaError, normalizeMarginRecord } from "@/lib/margins/margins"
import { createClient } from "@/lib/supabase/server"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// PATCH /api/margins/[id] — edit a margin's note or toggle its shared state
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "UNAUTHORIZED", "No active session.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, "INVALID_INPUT", "Invalid JSON body.")
  }

  const parsed = z
    .object({
      text: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      shared: z.boolean().optional(),
    })
    .refine((data) => data.note !== undefined || data.text !== undefined || data.shared !== undefined, {
      message: "At least one of text, note or shared must be provided.",
    })
    .safeParse(body)

  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.message)

  const { id } = await context.params

  const updateData: { text?: string | null; note?: string | null; shared?: boolean; shared_at?: string | null } = {}
  if (parsed.data.text !== undefined) {
    updateData.text = parsed.data.text
    updateData.note = parsed.data.text
  }
  if (parsed.data.note !== undefined) {
    updateData.note = parsed.data.note
    updateData.text = parsed.data.note
  }
  if (parsed.data.shared !== undefined) {
    updateData.shared = parsed.data.shared
    updateData.shared_at = parsed.data.shared ? new Date().toISOString() : null
  }

  let { data, error } = await supabase
    .from("margins")
    .update(updateData)
    .eq("id", id)
    .eq("reader_id", user.id)
    .select()
    .maybeSingle()

  if (error && isLegacyMarginsSchemaError(error)) {
    const legacyUpdateData: typeof updateData = {}
    if (updateData.note !== undefined || updateData.text !== undefined) {
      legacyUpdateData.note = updateData.note ?? updateData.text ?? null
    }
    if (updateData.shared !== undefined) {
      legacyUpdateData.shared = updateData.shared
      legacyUpdateData.shared_at = updateData.shared_at ?? null
    }

    const legacyResult = await supabase
      .from("margins")
      .update(legacyUpdateData)
      .eq("id", id)
      .eq("reader_id", user.id)
      .select("id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note, shared, shared_at, created_at, updated_at")
      .maybeSingle()

    data = legacyResult.data ? normalizeMarginRecord(legacyResult.data) : null
    error = legacyResult.error
  }

  if (error) {
    console.error("[margins:patch]", { userId: user.id, marginId: id, error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  if (!data) return jsonError(404, "NOT_FOUND", "Margin not found.")

  return NextResponse.json({ data, error: null }, { status: 200 })
}

// DELETE /api/margins/[id] — delete a margin
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const { id } = await context.params

  const { error } = await supabase
    .from("margins")
    .delete()
    .eq("id", id)
    .eq("reader_id", user.id)

  if (error) {
    console.error("[margins:delete]", { userId: user.id, marginId: id, error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  return new NextResponse(null, { status: 204 })
}
