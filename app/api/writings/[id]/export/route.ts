import type { JSONContent } from "@tiptap/core"
import { NextResponse } from "next/server"
import { z } from "zod"
import { buildWritingExportDocument, getExportFileBaseName } from "@/lib/export/writing-export"
import { renderWritingToDocxBuffer } from "@/lib/export/to-docx"
import { renderWritingToPdfBuffer } from "@/lib/export/to-pdf"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const paramsSchema = z.object({ id: z.string().uuid() })
const formatSchema = z.enum(["pdf", "docx"])

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

const getCurrentUserId = async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id ?? null
}

const getRequestedFormat = (request: Request) => {
  const { searchParams } = new URL(request.url)
  return formatSchema.safeParse(searchParams.get("format"))
}

const buildContentDisposition = (filename: string): string => {
  // Extract extension (e.g., ".pdf", ".docx") so we preserve it on the fallback
  const extMatch = filename.match(/(\.[^.]+)$/)
  const ext = extMatch ? extMatch[1] : ""

  // ASCII fallback for legacy browsers (strip non-ASCII chars from basename)
  const asciiFallback =
    filename
      .replace(/(\.[^.]+)$/, "")
      .replace(/[^\x00-\x7F]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "export"

  const safeFallback = `${asciiFallback}${ext}`

  // RFC 5987 / RFC 8187 UTF-8 encoded filename for modern browsers
  const encoded = encodeURIComponent(filename)

  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encoded}`
}

const buildDownloadHeaders = (params: { contentType: string; filename: string }) => ({
  "Content-Type": params.contentType,
  "Content-Disposition": buildContentDisposition(params.filename),
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
})

const getDisplayTitle = (title: string | null, bodyText: string | null, writingId: string) => {
  const trimmedTitle = title?.trim()
  if (trimmedTitle) {
    return trimmedTitle
  }

  const fallbackWords = bodyText
    ?.trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ")
    .trim()

  return fallbackWords || writingId.slice(0, 8)
}

export async function GET(request: Request, context: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return jsonError(401, "UNAUTHORIZED", "No active session.")

  const params = await context.params
  const parsedParams = paramsSchema.safeParse(params)
  if (!parsedParams.success) return jsonError(400, "INVALID_WRITING_ID", "Invalid writing ID.")

  const formatParsed = getRequestedFormat(request)
  if (!formatParsed.success) return jsonError(400, "INVALID_FORMAT", "format must be pdf or docx.")

  const admin = createAdminClient()
  const { data: writing, error } = await admin
    .from("writings")
    .select("id, author_id, title, body_json, body_text, deleted_at")
    .eq("id", parsedParams.data.id)
    .single()

  if (error) {
    return jsonError(404, "NOT_FOUND", "Writing not found.")
  }

  if (!writing || writing.deleted_at) {
    return jsonError(404, "NOT_FOUND", "Writing not found.")
  }

  if (writing.author_id !== userId) {
    return jsonError(403, "FORBIDDEN", "Writing not found or access denied.")
  }

  const exportDocument = buildWritingExportDocument(writing.body_json as JSONContent | null)
  const filenameBase = getExportFileBaseName({
    title: writing.title,
    bodyText: writing.body_text,
    writingId: writing.id,
  })
  const displayTitle = getDisplayTitle(writing.title, writing.body_text, writing.id)

  if (formatParsed.data === "pdf") {
    const buffer = await renderWritingToPdfBuffer({
      title: displayTitle,
      bodyText: writing.body_text,
      document: exportDocument,
    })

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: buildDownloadHeaders({
        contentType: "application/pdf",
        filename: `${filenameBase}.pdf`,
      }),
    })
  }

  const buffer = await renderWritingToDocxBuffer({
    title: displayTitle,
    bodyText: writing.body_text,
    document: exportDocument,
  })

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: buildDownloadHeaders({
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: `${filenameBase}.docx`,
    }),
  })
}
