import { NextResponse } from "next/server"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-2&language=es"

const jsonError = (request: Request, status: number, code: string, message: string) =>
  withCorsHeaders(
    NextResponse.json({ data: null, error: { code, message } }, { status }),
    request,
  )

export function OPTIONS(request: Request) {
  return handleCorsPreflight(request) ?? new Response(null, { status: 204 })
}

type DeepgramTranscriptionResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
      }>
    }>
  }
}

const getTranscript = (payload: DeepgramTranscriptionResponse) =>
  payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ""

export async function POST(request: Request) {
  const { userId } = await getCurrentUserFromRequest(request)

  if (!userId) return jsonError(request, 401, "UNAUTHORIZED", "No active session.")

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonError(request, 400, "INVALID_INPUT", "Invalid multipart form data.")
  }

  const audio = formData.get("audio")
  if (!(audio instanceof Blob)) {
    return jsonError(request, 400, "INVALID_INPUT", "audio file is required.")
  }

  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    return jsonError(request, 500, "SERVER_MISCONFIGURED", "Missing DEEPGRAM_API_KEY.")
  }

  const contentType = audio.type || "application/octet-stream"

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(DEEPGRAM_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": contentType,
      },
      body: audio,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reach Deepgram."
    console.error("[margins:transcribe:network]", { userId, message })
    return jsonError(request, 502, "TRANSCRIPTION_FAILED", message)
  }

  if (!upstreamResponse.ok) {
    const message = await upstreamResponse.text()
    console.error("[margins:transcribe:upstream]", {
      userId,
      status: upstreamResponse.status,
      message,
    })
    return jsonError(request, 502, "TRANSCRIPTION_FAILED", message || "Deepgram transcription failed.")
  }

  let payload: DeepgramTranscriptionResponse
  try {
    payload = (await upstreamResponse.json()) as DeepgramTranscriptionResponse
  } catch {
    return jsonError(request, 502, "TRANSCRIPTION_FAILED", "Deepgram returned an invalid JSON response.")
  }

  const transcript = getTranscript(payload)

  return withCorsHeaders(
    NextResponse.json(
      {
        data: { transcript },
        error: null,
      },
      { status: 200 },
    ),
    request,
  )
}
