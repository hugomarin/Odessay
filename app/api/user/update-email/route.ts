import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { sendEmailChangeNotification } from "@/lib/email/send-email-change-notification"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { updateEmailSchema } from "@/lib/validation/account-schemas"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
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

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/settings/account`
    const [{ data: currentLink, error: currentLinkError }, { data: newLink, error: newLinkError }] =
      await Promise.all([
        admin.auth.admin.generateLink({
          type: "email_change_current",
          email: user.email,
          newEmail: payload.email,
          options: { redirectTo },
        }),
        admin.auth.admin.generateLink({
          type: "email_change_new",
          email: user.email,
          newEmail: payload.email,
          options: { redirectTo },
        }),
      ])

    if (currentLinkError || newLinkError) {
      const authError = currentLinkError ?? newLinkError
      return jsonError(
        400,
        "EMAIL_CHANGE_FAILED",
        authError?.message ?? "Could not start email change.",
      )
    }

    await sendEmailChangeNotification({
      currentEmail: user.email,
      newEmail: payload.email,
      currentEmailActionLink: currentLink.properties.action_link,
      newEmailActionLink: newLink.properties.action_link,
    })

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
