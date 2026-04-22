import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPreviewWritingFromTestLink } from "@/lib/sharing/test-link-access"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

// GET /api/margins/preview?token=<token> — list shared margins for a preview writing
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get("token")

  if (!token) return jsonError(400, "INVALID_INPUT", "token is required.")

  const parsedToken = z
    .string()
    .trim()
    .min(16)
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/)
    .safeParse(token)

  if (!parsedToken.success) return jsonError(400, "INVALID_INPUT", "Invalid token format.")

  const result = await getPreviewWritingFromTestLink(parsedToken.data)

  if (result.state !== "ok") {
    return jsonError(404, "NOT_FOUND", "Preview link not found or revoked.")
  }

  const writingId = result.writing.id
  const admin = createAdminClient()

  const { data, error } = await admin
    .from("margins")
    .select("id, writing_id, anchor_start, anchor_end, anchor_text, note, shared, shared_at, created_at, updated_at")
    .eq("writing_id", writingId)
    .eq("shared", true)
    .order("anchor_start", { ascending: true })

  if (error) {
    console.error("[margins:preview:get]", { writingId, tokenFingerprint: token.slice(0, 8), error: error.message })
    return jsonError(500, "DB_ERROR", error.message)
  }

  return NextResponse.json({ data: data ?? [], error: null }, { status: 200 })
}
