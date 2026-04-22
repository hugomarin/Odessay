import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { createClient } from "@/lib/supabase/server"
import {
  claimUsernameForCurrentUser,
  getUsernameAvailability,
  syncUserMetadata,
} from "@/lib/supabase/queries/user"
import { updateUsernameSchema } from "@/lib/validation/account-schemas"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "No active session.")
    }

    const { searchParams } = new URL(request.url)
    const parsed = updateUsernameSchema.parse({
      username: searchParams.get("username") ?? "",
    })
    const availability = await getUsernameAvailability(user.id, parsed.username)

    return NextResponse.json({ data: availability, error: null })
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, "INVALID_INPUT", error.issues[0]?.message ?? "Invalid input.")
    }

    console.error("[api/user/update-username.GET]", error)
    return jsonError(500, "SERVER_ERROR", "Could not validate username.")
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return jsonError(401, "UNAUTHORIZED", "No active session.")
    }

    const payload = updateUsernameSchema.parse(await request.json())
    const availability = await getUsernameAvailability(user.id, payload.username)

    if (!availability.available) {
      return jsonError(
        409,
        availability.reason === "reserved" ? "USERNAME_RESERVED" : "USERNAME_TAKEN",
        availability.reason === "reserved"
          ? "That username is reserved for another account right now."
          : "That username is already taken.",
      )
    }

    const result = await claimUsernameForCurrentUser(payload.username)
    await syncUserMetadata(user.id, { username: result.username })

    return NextResponse.json({
      data: result,
      error: null,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, "INVALID_INPUT", error.issues[0]?.message ?? "Invalid input.")
    }

    console.error("[api/user/update-username.POST]", error)
    return jsonError(500, "SERVER_ERROR", "Could not update username.")
  }
}
