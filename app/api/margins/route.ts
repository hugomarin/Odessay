import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const createMarginSchema = z.object({
  writing_id: z.string().uuid(),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(1),
  anchor_text: z.string().min(1),
  note: z.string().nullable().optional(),
})

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// GET /api/margins?writing_id=<uuid> — list margins for a writing (reader sees own, author sees shared)
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const { searchParams } = new URL(request.url)
  const writingId = searchParams.get("writing_id")

  if (!writingId) return jsonError(400, "INVALID_INPUT", "writing_id is required.")

  const { data, error } = await supabase
    .from("margins")
    .select("id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, note, shared, shared_at, created_at, updated_at")
    .eq("writing_id", writingId)
    .order("anchor_start", { ascending: true })

  if (error) {
    console.error("[margins:get]", { userId: user.id, writingId, error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 200 })
}

// POST /api/margins — create a new margin (highlight or annotation)
export async function POST(request: Request) {
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

  const parsed = createMarginSchema.safeParse(body)
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.message)

  const { writing_id, anchor_start, anchor_end, anchor_text, note } = parsed.data

  if (anchor_end <= anchor_start) {
    return jsonError(400, "INVALID_INPUT", "anchor_end must be greater than anchor_start.")
  }

  const { data, error } = await supabase
    .from("margins")
    .insert({
      reader_id: user.id,
      writing_id,
      anchor_start,
      anchor_end,
      anchor_text,
      note: note ?? null,
      shared: false,
    })
    .select()
    .single()

  if (error) {
    console.error("[margins:post]", { userId: user.id, writingId: writing_id, error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 201 })
}

// PATCH /api/margins/share — share all margins for a writing with the author
// Body: { writing_id: string }
export async function PATCH(request: Request) {
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

  const parsed = z.object({ writing_id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.message)

  const { writing_id } = parsed.data
  const sharedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from("margins")
    .update({ shared: true, shared_at: sharedAt })
    .eq("writing_id", writing_id)
    .eq("reader_id", user.id)
    .select()

  if (error) {
    console.error("[margins:share]", { userId: user.id, writingId: writing_id, error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 200 })
}
