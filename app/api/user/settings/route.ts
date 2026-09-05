import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { deriveDisabledStatuses, listVocabulary, setDisabledStatuses } from "@/lib/vocabulary/server"

const settingsPatchSchema = z.object({
  disabled_statuses: z.array(z.enum(WRITING_STATUS_VALUES)).optional(),
}).refine((data) => {
  if (data.disabled_statuses === undefined) {
    return true
  }
  return !data.disabled_statuses.includes("draft")
}, {
  message: "draft cannot be disabled",
})

export async function GET() {
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

  return NextResponse.json(
    {
      data: {
        disabledStatuses: deriveDisabledStatuses(result.data),
        vocabulary: result.data,
      },
      error: null,
    },
    { status: 200 },
  )
}

export async function PATCH(request: Request) {
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

  const body = await request.json()
  const parsed = settingsPatchSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: { code: "INVALID_INPUT", message: parsed.error.message } },
      { status: 400 },
    )
  }

  if (parsed.data.disabled_statuses === undefined) {
    return NextResponse.json(
      { data: null, error: { code: "INVALID_INPUT", message: "No fields to update." } },
      { status: 400 },
    )
  }

  const result = await setDisabledStatuses(supabase, user.id, parsed.data.disabled_statuses)
  if (result.error) {
    const status = result.error.code === "INVALID_INPUT" ? 400 : 500
    return NextResponse.json({ data: null, error: result.error }, { status })
  }

  return NextResponse.json(
    {
      data: {
        disabledStatuses: deriveDisabledStatuses(result.data),
        vocabulary: result.data,
      },
      error: null,
    },
    { status: 200 },
  )
}
