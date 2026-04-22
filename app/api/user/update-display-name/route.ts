import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { createClient } from "@/lib/supabase/server"
import { updateDisplayNameForUser } from "@/lib/supabase/queries/user"
import { updateDisplayNameSchema } from "@/lib/validation/account-schemas"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "No active session.")
    }

    const payload = updateDisplayNameSchema.parse(await request.json())
    const displayName = await updateDisplayNameForUser(user.id, payload.displayName)

    return NextResponse.json({
      data: {
        displayName,
      },
      error: null,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, "INVALID_INPUT", error.issues[0]?.message ?? "Invalid input.")
    }

    console.error("[api/user/update-display-name]", error)
    return jsonError(500, "SERVER_ERROR", "Could not update display name.")
  }
}
