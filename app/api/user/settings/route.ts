import { NextResponse } from "next/server"
import type { PostgrestError } from "@supabase/supabase-js"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { parseDisabledStatuses } from "@/lib/user/settings"
import { WRITING_STATUS_VALUES } from "@/lib/writings/status"

const settingsPatchSchema = z.object({
  disabled_statuses: z.array(z.enum(WRITING_STATUS_VALUES)).optional(),
})

const isMissingDisabledStatusesColumn = (error: PostgrestError | null) => {
  if (!error) {
    return false
  }

  return error.message.includes("disabled_statuses")
}

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

  const { data, error } = await supabase
    .from("profiles")
    .select("disabled_statuses")
    .eq("id", user.id)
    .single()

  if (isMissingDisabledStatusesColumn(error)) {
    return NextResponse.json(
      { data: { disabledStatuses: [] }, error: null },
      { status: 200 },
    )
  }

  if (error) {
    return NextResponse.json(
      { data: null, error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    )
  }

  const disabledStatuses = parseDisabledStatuses(data?.disabled_statuses)

  return NextResponse.json(
    { data: { disabledStatuses }, error: null },
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

  const updates: Record<string, unknown> = {}

  if (parsed.data.disabled_statuses !== undefined) {
    updates.disabled_statuses = parsed.data.disabled_statuses
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { data: null, error: { code: "INVALID_INPUT", message: "No fields to update." } },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("disabled_statuses")
    .single()

  if (isMissingDisabledStatusesColumn(error)) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "SCHEMA_OUTDATED",
          message: "profiles.disabled_statuses column is not available in this database yet.",
        },
      },
      { status: 503 },
    )
  }

  if (error) {
    return NextResponse.json(
      { data: null, error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    )
  }

  const disabledStatuses = parseDisabledStatuses(data?.disabled_statuses)

  return NextResponse.json(
    { data: { disabledStatuses }, error: null },
    { status: 200 },
  )
}
