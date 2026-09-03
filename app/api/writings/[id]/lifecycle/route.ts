import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"
import { createClient } from "@/lib/supabase/server"
import { serializeDocumentToMarkdown } from "@/lib/editor/document-serialization"

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restore"), version: z.number().int().positive(), updated_at: z.string().datetime() }),
  z.object({ action: z.literal("delete-permanently") }),
])

const failure = (status: number, code: string, message: string) => NextResponse.json({ data: null, error: { code, message } }, { status })

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) return failure(401, "UNAUTHORIZED", "No active session.")
  if (new URL(request.url).searchParams.get("action") !== "download") return failure(400, "INVALID_INPUT", "Unknown lifecycle action.")
  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase.from("writings").select("id,title,body_json,body_text,deleted_at").eq("id", id).eq("author_id", userId).not("deleted_at", "is", null).maybeSingle()
  if (error) return failure(500, "DB_ERROR", error.message)
  if (!data) return failure(404, "NOT_FOUND", "Archived artifact not found.")
  let content = data.body_text
  try { content = serializeDocumentToMarkdown(data.body_json as Record<string, unknown>) } catch { /* plain-text recovery */ }
  const name = `${(data.title || "Untitled").replace(/[^a-z0-9 _-]/gi, "").trim() || "Untitled"}.md`
  return new NextResponse(content, { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await getCurrentUserFromRequest(request)
  if (!userId) return failure(401, "UNAUTHORIZED", "No active session.")
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return failure(400, "INVALID_INPUT", parsed.error.message)
  const { id } = await params
  const supabase = await createClient()
  const archived = await supabase.from("writings").select("id,version").eq("id", id).eq("author_id", userId).not("deleted_at", "is", null).maybeSingle()
  if (archived.error) return failure(500, "DB_ERROR", archived.error.message)
  if (!archived.data) return failure(404, "NOT_FOUND", "Archived artifact not found.")
  if (parsed.data.action === "restore") {
    if (archived.data.version !== parsed.data.version) {
      return failure(409, "VERSION_CONFLICT", "This archived writing changed before it could be restored.")
    }
    const { data, error } = await supabase
      .from("writings")
      .update({ deleted_at: null, updated_at: parsed.data.updated_at, sync_status: "synced", version: parsed.data.version + 1 })
      .eq("id", id)
      .eq("author_id", userId)
      .eq("version", parsed.data.version)
      .not("deleted_at", "is", null)
      .select()
      .maybeSingle()
    if (error) return failure(500, "DB_ERROR", error.message)
    if (!data) return failure(409, "VERSION_CONFLICT", "This archived writing changed before it could be restored.")
    return NextResponse.json({ data, error: null })
  }
  const { error } = await supabase.from("writings").delete().eq("id", id).eq("author_id", userId).not("deleted_at", "is", null)
  return error ? failure(500, "DB_ERROR", error.message) : NextResponse.json({ data: { id }, error: null })
}
