import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isUuidLikeWritingIdentifier } from "@/lib/writings/writing-route"

const createMarginSchema = z.object({
  writing_id: z.string().min(1),
  anchor_start: z.number().int().min(0),
  anchor_end: z.number().int().min(1),
  anchor_text: z.string().min(1),
  type: z.enum(["personal", "ai", "collaborative", "footnote", "highlight"]).default("personal"),
  text: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
})

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

async function resolveWritingId(identifier: string): Promise<string | null> {
  const admin = createAdminClient()
  const lookupOrder = isUuidLikeWritingIdentifier(identifier) ? ["id", "slug"] : ["slug", "id"]

  for (const field of lookupOrder) {
    const { data, error } = await admin
      .from("writings")
      .select("id")
      .eq(field, identifier)
      .maybeSingle()

    if (error) {
      console.error("[margins:resolve-writing-id]", { identifier, field, error: error.message })
      return null
    }

    if (data?.id) return data.id as string
  }

  return null
}

// GET /api/margins?writing_id=<uuid> — list margins for a writing (reader sees own, author sees shared)
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const { searchParams } = new URL(request.url)
  const writingIdentifier = searchParams.get("writing_id")

  if (!writingIdentifier) return jsonError(400, "INVALID_INPUT", "writing_id is required.")

  const writingId = await resolveWritingId(writingIdentifier)
  if (!writingId) return jsonError(404, "NOT_FOUND", "Writing not found.")

  const { data, error } = await supabase
    .from("margins")
    .select("id, reader_id, writing_id, anchor_start, anchor_end, anchor_text, type, text, note, shared, shared_at, archived, resolved, created_at, updated_at")
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

  const { writing_id, anchor_start, anchor_end, anchor_text, note, text, type } = parsed.data

  const resolvedWritingId = await resolveWritingId(writing_id)
  if (!resolvedWritingId) return jsonError(404, "NOT_FOUND", "Writing not found.")

  if (anchor_end <= anchor_start) {
    return jsonError(400, "INVALID_INPUT", "anchor_end must be greater than anchor_start.")
  }

  const { data, error } = await supabase
    .from("margins")
    .insert({
      reader_id: user.id,
      writing_id: resolvedWritingId,
      anchor_start,
      anchor_end,
      anchor_text,
      type: type === "footnote" ? "personal" : type,
      text: text ?? note ?? "",
      note: note ?? text ?? null,
      shared: false,
    })
    .select()
    .single()

  if (error) {
    console.error("[margins:post]", { userId: user.id, writingId: resolvedWritingId, error: error.message })
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

  const parsed = z.object({ writing_id: z.string().min(1) }).safeParse(body)
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.message)

  const resolvedWritingId = await resolveWritingId(parsed.data.writing_id)
  if (!resolvedWritingId) return jsonError(404, "NOT_FOUND", "Writing not found.")
  const sharedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from("margins")
    .update({ shared: true, shared_at: sharedAt })
    .eq("writing_id", resolvedWritingId)
    .eq("reader_id", user.id)
    .select()

  if (error) {
    console.error("[margins:share]", { userId: user.id, writingId: resolvedWritingId, error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data, error: null }, { status: 200 })
}
