import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { deleteVocabularyItem, updateVocabularyItem } from "@/lib/vocabulary/server"
import { ARTIFACT_TYPE_ICON_NAMES, WRITING_STATUS_ICON_NAMES } from "@/lib/settings/vocabulary"

const updateVocabularySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  icon: z.enum([...ARTIFACT_TYPE_ICON_NAMES, ...WRITING_STATUS_ICON_NAMES]).optional(),
  color: z.string().optional(),
  hidden: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
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
  const parsed = updateVocabularySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "INVALID_INPUT", message: parsed.error.message } },
      { status: 400 },
    )
  }

  const result = await updateVocabularyItem(supabase, user.id, id, parsed.data)
  if (result.error) {
    const status = result.error.code === "INVALID_INPUT" ? 400 : 500
    return NextResponse.json({ data: null, error: result.error }, { status })
  }

  return NextResponse.json({ data: result.data, error: null }, { status: 200 })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
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

  const result = await deleteVocabularyItem(supabase, user.id, id)
  if (result.error) {
    const status = result.error.code === "INVALID_INPUT" ? 400 : 500
    return NextResponse.json({ data: null, error: result.error }, { status })
  }

  return NextResponse.json({ data: result.data, error: null }, { status: 200 })
}
