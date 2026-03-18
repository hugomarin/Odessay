import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isUsernameFormatValid, normalizeUsername } from "@/lib/auth/validation"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawValue = searchParams.get("value") ?? ""
  const username = normalizeUsername(rawValue)

  if (!isUsernameFormatValid(username)) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "INVALID_INPUT",
          message: "Username format is invalid.",
        },
      },
      { status: 400 },
    )
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("public_profiles")
      .select("username")
      .eq("username", username)
      .maybeSingle()

    if (error) {
      console.error("[auth:username-check:db]", {
        username,
        error: error.message,
      })

      return NextResponse.json(
        {
          data: null,
          error: {
            code: "DB_ERROR",
            message: "Could not validate username availability.",
          },
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      data: {
        available: !data,
        username,
      },
      error: null,
    })
  } catch (error) {
    console.error("[auth:username-check:unexpected]", {
      username,
      error: error instanceof Error ? error.message : "Unexpected error",
    })

    return NextResponse.json(
      {
        data: null,
        error: {
          code: "SERVER_ERROR",
          message: "Could not validate username availability.",
        },
      },
      { status: 500 },
    )
  }
}
