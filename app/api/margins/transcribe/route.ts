import { NextResponse } from "next/server"
import { getCurrentUserFromRequest } from "@/lib/supabase/request-auth"
import { handleCorsPreflight, withCorsHeaders } from "@/lib/cors"
import { releaseAiAdmission, tryAcquireAiAdmission, logAiAdmissionEvent } from "@/lib/ai/admission"
import { getAudioLimitsConfig } from "@/lib/ai/admission-config"
import { estimateAudioMetadata } from "@/lib/ai/audio-limits"

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-2&language=es"

// ODE-524: Deepgram itself is normally fast for audio this short, but a
// finite ceiling is required regardless — the provider call must not be
// able to hold the admitted concurrency slot open indefinitely.
const PROVIDER_REQUEST_TIMEOUT_MS = 45_000

// Requirement 4: only content types this route actually forwards to
// Deepgram — matches the set the client's recorder can produce
// (lib/services/transcription/transcribe-voice-note.ts).
const ALLOWED_AUDIO_CONTENT_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
])

const jsonError = (request: Request, status: number, code: string, message: string, headers?: HeadersInit) =>
  withCorsHeaders(
    NextResponse.json({ data: null, error: { code, message } }, { status, headers }),
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

  const audioLimits = getAudioLimitsConfig()

  // Requirement 4: reject an oversize upload from its declared length before
  // touching the body at all, when the client sends one.
  const declaredLength = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declaredLength) && declaredLength > audioLimits.maxBytes) {
    return jsonError(request, 413, "PAYLOAD_TOO_LARGE", "Recording is too large to transcribe.")
  }

  // Requirements 1-2: admission before any provider work. This route shares
  // its concurrency ceiling with title-suggestions and publication-review.
  const admission = await tryAcquireAiAdmission({ accountId: userId, routeKey: "transcription" })
  if (!admission.admitted) {
    return jsonError(
      request,
      429,
      admission.reason === "rate_limited" ? "RATE_LIMITED" : "CONCURRENCY_LIMITED",
      "Too many AI requests right now. Try again shortly.",
      { "Retry-After": String(admission.retryAfterSeconds) },
    )
  }

  try {
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

    // Defense in depth for the case content-length was absent/wrong
    // (e.g. chunked transfer encoding) — the parsed Blob's own size is
    // authoritative once the body has actually been read.
    if (audio.size > audioLimits.maxBytes) {
      return jsonError(request, 413, "PAYLOAD_TOO_LARGE", "Recording is too large to transcribe.")
    }

    const contentType = audio.type.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream"
    if (!ALLOWED_AUDIO_CONTENT_TYPES.has(contentType)) {
      return jsonError(request, 415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported audio format.")
    }

    const audioBytes = new Uint8Array(await audio.arrayBuffer())

    // Requirement 4: duration bound derived from the bytes themselves, never
    // from anything the client claims — see lib/ai/audio-limits.ts for why
    // this is exact for WAV and a conservative estimate otherwise.
    const metadata = estimateAudioMetadata(audioBytes, contentType)
    if (!metadata.ok) {
      return jsonError(request, 400, "INVALID_INPUT", metadata.reason)
    }
    if (metadata.durationSeconds > audioLimits.maxDurationSeconds) {
      return jsonError(request, 413, "PAYLOAD_TOO_LARGE", "Recording is too long to transcribe.")
    }

    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) {
      return jsonError(request, 500, "SERVER_MISCONFIGURED", "Missing DEEPGRAM_API_KEY.")
    }

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), PROVIDER_REQUEST_TIMEOUT_MS)

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(DEEPGRAM_URL, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body: audioBytes,
        signal: abortController.signal,
      })
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError"
      logAiAdmissionEvent({ event: isAbort ? "timeout" : "provider_error", routeKey: "transcription" })
      const message = isAbort ? "Transcription timed out." : "Failed to reach Deepgram."
      console.error("[margins:transcribe:network]", { userId, message, isAbort })
      return jsonError(request, isAbort ? 504 : 502, "TRANSCRIPTION_FAILED", message)
    } finally {
      clearTimeout(timeoutId)
    }

    if (!upstreamResponse.ok) {
      const message = await upstreamResponse.text()
      logAiAdmissionEvent({ event: "provider_error", routeKey: "transcription" })
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
  } finally {
    // Requirement: release on every exit path — success, denial after
    // admission, thrown error, or timeout — so the concurrency ceiling
    // never stays artificially full.
    await releaseAiAdmission(admission.leaseId)
  }
}
