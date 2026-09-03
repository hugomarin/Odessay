import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createVocabularyItem, getVocabularyUsage, listVocabulary } from "@/lib/vocabulary/server"
import { ARTIFACT_TYPE_ICON_NAMES, WRITING_STATUS_ICON_NAMES } from "@/lib/settings/vocabulary"

const createVocabularySchema = z.object({
  kind: z.enum(["type", "status"]),
  name: z.string(),
  description: z.string().optional(),
  icon: z.enum([...ARTIFACT_TYPE_ICON_NAMES, ...WRITING_STATUS_ICON_NAMES]),
  color: z.string(),
})

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { data: null, error: { code: "UNAUTHORIZED", message: "No active session." } },
      { status: 401 },
    )
  }

  const result = await listVocabulary(supabase, user.id)
  if (result.error) {
    return NextResponse.json({ data: null, error: result.error }, { status: 500 })
  }

  const url = new URL(request.url)
  if (url.searchParams.get("usage") === "1") {
    const usage = await getVocabularyUsage(supabase, user.id, result.data)
    if (usage.error) {
      return NextResponse.json({ data: null, error: usage.error }, { status: 500 })
    }
    return NextResponse.json(
      { data: { items: result.data, usage: usage.data }, error: null },
      { status: 200 },
    )
  }

  return NextResponse.json({ data: { items: result.data }, error: null }, { status: 200 })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { data: null, error: { code: "UNAUTHORIZED", message: "No active session." } },
      { status: 401 },
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = createVocabularySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "INVALID_INPUT", message: parsed.error.message } },
      { status: 400 },
    )
  }

  const result = await createVocabularyItem(supabase, user.id, parsed.data)
  if (result.error) {
    const status = result.error.code === "INVALID_INPUT" ? 400 : 500
    return NextResponse.json({ data: null, error: result.error }, { status })
  }

  return NextResponse.json({ data: result.data, error: null }, { status: 201 })
}
