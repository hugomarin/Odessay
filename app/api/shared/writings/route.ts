import { NextResponse } from "next/server"
import { createWebSharingService } from "@/lib/services/web-sharing-service"
import { createClient } from "@/lib/supabase/server"

const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ data: null, error: { code, message } }, { status })

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const sharingService = await createWebSharingService({ userId: user?.id ?? null })
  const result = await sharingService.listIncomingShares()

  if (result.error) {
    return jsonError(result.error.code === "UNAUTHORIZED" ? 401 : 500, result.error.code, result.error.message)
  }

  return NextResponse.json({ data: result.data, error: null }, { status: 200 })
}
