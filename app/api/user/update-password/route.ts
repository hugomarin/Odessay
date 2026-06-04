import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { verifyCurrentPassword } from "@/lib/auth/account-settings"
import { createClient } from "@/lib/supabase/server"
import { updatePasswordSchema } from "@/lib/validation/account-schemas"

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

    const payload = updatePasswordSchema.parse(await request.json())
    const isCurrentPasswordValid = await verifyCurrentPassword(user.email, payload.currentPassword)

    if (!isCurrentPasswordValid) {
      return jsonError(400, "INVALID_CURRENT_PASSWORD", "Your current password is incorrect.")
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: payload.newPassword,
    })

    if (updateError) {
      return jsonError(400, "PASSWORD_UPDATE_FAILED", updateError.message)
    }

    const { error: revokeError } = await supabase.auth.signOut({ scope: "others" })

    if (revokeError) {
      console.error("[api/user/update-password:revoke]", revokeError)
    }

    return NextResponse.json({
      data: {
        revokedOtherSessions: !revokeError,
      },
      error: null,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, "INVALID_INPUT", error.issues[0]?.message ?? "Invalid input.")
    }

    console.error("[api/user/update-password]", error)
    return jsonError(500, "SERVER_ERROR", "Could not update password.")
  }
}
