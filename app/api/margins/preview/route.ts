import { NextResponse } from "next/server"
import { z } from "zod"
import { getPreviewSharedMargins } from "@/lib/margins/margins"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPreviewWritingFromTestLink } from "@/lib/sharing/test-link-access"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

const TEST_LINK_FIXTURE_ENABLED = process.env.ODE_TEST_LINK_FIXTURES === "1"
const PREVIEW_MARGIN_FIXTURES: Record<string, []> = {
  fixturepreviewoktoken0001: [],
}

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

  if (TEST_LINK_FIXTURE_ENABLED && token in PREVIEW_MARGIN_FIXTURES) {
    return NextResponse.json({ data: PREVIEW_MARGIN_FIXTURES[token], error: null }, { status: 200 })
  }

  const writingId = result.writing.id
  const admin = createAdminClient()

  try {
    const data = await getPreviewSharedMargins(admin, writingId)
    return NextResponse.json({ data, error: null }, { status: 200 })
  } catch (error) {
    console.error("[margins:preview:get]", {
      writingId,
      tokenFingerprint: token.slice(0, 8),
      error: error instanceof Error ? error.message : "Unknown error",
    })
    return jsonError(500, "DB_ERROR", error instanceof Error ? error.message : "Failed to load preview margins.")
  }
}
