import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import type { JSONContent } from "@tiptap/core"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPreviewWritingFromTestLink } from "@/lib/sharing/test-link-access"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"

const importPayloadSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("preview"),
    token: z.string().trim().min(1),
  }),
  z.object({
    source: z.literal("shared"),
    writingId: z.string().uuid(),
  }),
])

type SharedSourceWritingRow = {
  id: string
  author_id: string
  title: string | null
  body_json: JSONContent | null
  body_text: string
}

const SHARED_SOURCE_SELECT = "id, author_id, title, body_json, body_text"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  )

const buildCopyTitle = (title: string | null) => `Copy of ${title?.trim() || "Untitled artifact"}`

const createEmptyDocument = (): JSONContent => ({
  type: "doc",
  content: [],
})

export async function POST(request: Request) {
  const { userId } = await getCurrentUserFromRequest(request)

  if (!userId) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  const payload = await request.json().catch(() => null)
  const parsed = importPayloadSchema.safeParse(payload)

  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", parsed.error.message)
  }

  const supabase = createAdminClient()

  let sourceTitle: string | null
  let sourceBodyJson: JSONContent | null
  let sourceBodyText: string

  if (parsed.data.source === "preview") {
    const preview = await getPreviewWritingFromTestLink(parsed.data.token)

    if (preview.state === "not-found") {
      return jsonError(404, "PREVIEW_NOT_FOUND", "Preview link not found.")
    }

    if (preview.state === "revoked") {
      return jsonError(404, "PREVIEW_REVOKED", "Preview link has been revoked.")
    }

    if (preview.state === "unavailable") {
      return jsonError(500, "PREVIEW_UNAVAILABLE", "Preview link is temporarily unavailable.")
    }

    sourceTitle = preview.writing.title
    sourceBodyJson = preview.writing.bodyJson
    sourceBodyText = preview.writing.bodyText
  } else {
    const { data: writing, error: writingError } = await supabase
      .from("writings")
      .select(SHARED_SOURCE_SELECT)
      .eq("id", parsed.data.writingId)
      .is("deleted_at", null)
      .maybeSingle<SharedSourceWritingRow>()

    if (writingError) {
      return jsonError(500, "DB_ERROR", writingError.message)
    }

    if (!writing) {
      return jsonError(404, "NOT_FOUND", "Shared artifact not found.")
    }

    if (writing.author_id !== userId) {
      const { data: shareRow, error: shareError } = await supabase
        .from("writing_shares")
        .select("id")
        .eq("writing_id", writing.id)
        .eq("shared_with_id", userId)
        .maybeSingle()

      if (shareError) {
        return jsonError(500, "DB_ERROR", shareError.message)
      }

      if (!shareRow) {
        return jsonError(403, "FORBIDDEN", "You do not have access to this shared artifact.")
      }
    }

    sourceTitle = writing.title
    sourceBodyJson = writing.body_json
    sourceBodyText = writing.body_text
  }

  const now = new Date().toISOString()
  const row = {
    id: randomUUID(),
    author_id: userId,
    title: buildCopyTitle(sourceTitle),
    body_json: sourceBodyJson ?? createEmptyDocument(),
    body_text: sourceBodyText,
    status: "draft",
    visibility: "private",
    artifact_type: "general",
    parent_id: null,
    correspondence_id: null,
    version: 1,
    sync_status: "synced",
    deleted_at: null,
    created_at: now,
    updated_at: now,
    content_updated_at: now,
    metadata_updated_at: now,
  }

  const { data: insertedWriting, error: insertError } = await supabase
    .from("writings")
    .insert(row)
    .select("id")
    .single<{ id: string }>()

  if (insertError) {
    return jsonError(500, "DB_ERROR", insertError.message)
  }

  return NextResponse.json({ id: insertedWriting.id }, { status: 201 })
}
