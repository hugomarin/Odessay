import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// PATCH /api/margins/[id] — edit a margin's note
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

  const parsed = z.object({ note: z.string().nullable() }).safeParse(body)
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.message)

  const { id } = await context.params

  const { data, error } = await supabase
    .from("margins")
    .update({ note: parsed.data.note })
    .eq("id", id)
    .eq("reader_id", user.id)
    .select()
    .maybeSingle()

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
