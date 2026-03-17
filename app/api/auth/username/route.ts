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
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "DB_ERROR",
            message: error.message,
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
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "SERVER_ERROR",
          message: error instanceof Error ? error.message : "Unexpected error",
        },
      },
      { status: 500 },
    )
  }
}
