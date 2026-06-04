import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { getAccountEmailChangeRedirectUrl } from "@/lib/auth/account-settings"
import { createClient } from "@/lib/supabase/server"
import { updateEmailSchema } from "@/lib/validation/account-schemas"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.email) {
      return jsonError(401, "UNAUTHORIZED", "No active session.")
    }

    if (!user.email_confirmed_at) {
      return jsonError(
        409,
        "EMAIL_NOT_CONFIRMED",
        "Confirm your current email before requesting another change.",
      )
    }

    if (user.new_email && user.email_change_sent_at) {
      return jsonError(
        409,
        "EMAIL_CHANGE_PENDING",
        "You already have a pending email change. Confirm or revoke it from your inbox first.",
      )
    }

    const payload = updateEmailSchema.parse(await request.json())

    if (payload.email === user.email) {
      return jsonError(400, "NO_CHANGES", "Use a different email address.")
    }

    const { error: updateError } = await supabase.auth.updateUser(
      { email: payload.email },
      { emailRedirectTo: getAccountEmailChangeRedirectUrl() },
    )

    if (updateError) {
      return jsonError(
        400,
        "EMAIL_CHANGE_FAILED",
        updateError.message ?? "Could not start email change.",
      )
    }

    return NextResponse.json({
      data: {
        email: payload.email,
      },
      error: null,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, "INVALID_INPUT", error.issues[0]?.message ?? "Invalid input.")
    }

    console.error("[api/user/update-email]", error)
    return jsonError(500, "SERVER_ERROR", "Could not start email change.")
  }
}
