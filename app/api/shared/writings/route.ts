import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { listSharedWritingsForUser } from "@/lib/sharing/shared-writings"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError(401, "UNAUTHORIZED", "No active session.")
  }

  try {
    const items = await listSharedWritingsForUser(user.id)
    return NextResponse.json({ data: items, error: null }, { status: 200 })
  } catch (error) {
    return jsonError(
      500,
      "DB_ERROR",
      error instanceof Error ? error.message : "Failed to load shared writings.",
    )
  }
}
