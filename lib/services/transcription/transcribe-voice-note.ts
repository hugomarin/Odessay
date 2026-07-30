"use client"

import { isTauriRuntime } from "@/lib/runtime/detect"
import { createDesktopClient } from "@/lib/supabase/desktop-client"

// Voice-note transcription, runtime-aware.
//
// Web: POST the audio to the same-origin Next.js route (cookie session auth).
// Desktop (Tauri static export): the `/api/*` routes do not run — a relative
// request falls back to the SPA index.html (HTTP 200 HTML), which is why
// `res.json()` surfaced "The string did not match the expected pattern.".
// Instead, proxy to the hosted web runtime with the Supabase access token,
// mirroring `desktop-ai-service`. The Deepgram key stays server-side.

type TranscribePayload = {
  data: { transcript?: string } | null
  error: { message?: string } | null
}

type TranscribeVoiceNoteOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

export const EMPTY_RECORDING_MESSAGE = "The recording does not contain enough audio to transcribe."
export const TRANSCRIPTION_TIMEOUT_MS = 30_000

/**
 * User-facing failure messages (ODE-409).
 *
 * A raw `fetch` rejection surfaces as "Load failed" in WKWebView and "Failed to
 * fetch" in Chromium — neither tells the writer what to do, and both used to be
 * shown verbatim inside the annotation bubble. Every failure below is phrased as
 * an action, and every one of them keeps the recording so Retry can reuse the
 * same blob.
 */
export const TRANSCRIPTION_OFFLINE_MESSAGE =
  "Could not reach the transcription service. Check your connection and try again — your recording is kept."
export const TRANSCRIPTION_SESSION_MESSAGE =
  "Your session expired. Sign in again to transcribe — your recording is kept."
export const TRANSCRIPTION_SERVER_MESSAGE =
  "The transcription service failed. Try again — your recording is kept."

export function buildLocalRuntimeHostMessage(host: string) {
  return (
    `This desktop build is configured to reach the transcription service at ${host}, ` +
    `which is not running. Rebuild with NEXT_PUBLIC_APP_URL pointing at the hosted runtime — your recording is kept.`
  )
}

const LOCAL_RUNTIME_HOST_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/i

export function isLocalRuntimeHost(url: string) {
  return LOCAL_RUNTIME_HOST_PATTERN.test(url.trim().replace(/\/$/, ""))
}

const AUDIO_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "audio/mp4": "mp4",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
}

export function getVoiceNoteUploadMetadata(blob: Blob) {
  const mimeType = blob.type.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream"
  const extension = AUDIO_EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin"

  return {
    mimeType,
    extension,
    filename: `voice-note.${extension}`,
  }
}

export const TRANSCRIPTION_UNCONFIGURED_MESSAGE =
  "This desktop build has no transcription host configured (NEXT_PUBLIC_APP_URL). Rebuild pointing at the hosted runtime — your recording is kept."

function getWebRuntimeBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) {
    throw new Error(TRANSCRIPTION_UNCONFIGURED_MESSAGE)
  }
  return url.replace(/\/$/, "")
}

/**
 * Map a non-OK proxy response to an actionable message (ODE-409). A useful
 * server-side message is preserved; auth and 5xx failures get a phrasing that
 * tells the writer what to do next.
 */
function describeResponseFailure(response: Response, serverMessage: string | null): string {
  if (response.status === 401 || response.status === 403) {
    return TRANSCRIPTION_SESSION_MESSAGE
  }
  if (serverMessage && serverMessage.trim()) {
    return serverMessage
  }
  return TRANSCRIPTION_SERVER_MESSAGE
}

async function getBearerToken(): Promise<string | null> {
  try {
    const supabase = createDesktopClient()
    const { data, error } = await supabase.auth.getSession()

    if (error || !data.session) {
      return null
    }

    return data.session.access_token
  } catch {
    return null
  }
}

/**
 * Transcribe a recorded voice note and return the transcript text.
 * Throws an `Error` with a user-facing message on any failure.
 */
export async function transcribeVoiceNote(
  blob: Blob,
  options: TranscribeVoiceNoteOptions = {},
): Promise<string> {
  if (blob.size === 0) {
    throw new Error(EMPTY_RECORDING_MESSAGE)
  }

  const { filename } = getVoiceNoteUploadMetadata(blob)
  const formData = new FormData()
  formData.set("audio", blob, filename)

  const abortController = new AbortController()
  const timeoutMs = options.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS
  const timeoutId = globalThis.setTimeout(() => abortController.abort("timeout"), timeoutMs)
  const abortFromCaller = () => abortController.abort(options.signal?.reason)
  options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  if (options.signal?.aborted) {
    abortFromCaller()
  }

  // Resolve the desktop target outside the fetch try/catch: a missing host or a
  // missing session are configuration/auth problems with their own actionable
  // message, not network failures to be normalized (ODE-409).
  let request: { url: string; host: string; headers?: HeadersInit }
  try {
    if (isTauriRuntime()) {
      const runtimeHost = getWebRuntimeBaseUrl()
      const token = await getBearerToken()
      if (!token) {
        throw new Error(TRANSCRIPTION_SESSION_MESSAGE)
      }
      request = {
        url: `${runtimeHost}/api/margins/transcribe`,
        host: runtimeHost,
        headers: { authorization: `Bearer ${token}` },
      }
    } else {
      request = { url: "/api/margins/transcribe", host: "" }
    }
  } catch (error) {
    globalThis.clearTimeout(timeoutId)
    options.signal?.removeEventListener("abort", abortFromCaller)
    throw error
  }

  let response: Response

  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: formData,
      signal: abortController.signal,
    })
  } catch {
    if (abortController.signal.aborted) {
      if (options.signal?.aborted) {
        throw new DOMException("Transcription cancelled.", "AbortError")
      }
      throw new Error("Transcription timed out. Try again.")
    }
    // ODE-409: network/CORS rejections carry runtime-specific noise
    // ("Load failed" in WKWebView, "Failed to fetch" in Chromium). Translate
    // them into something the writer can act on.
    throw new Error(
      request.host && isLocalRuntimeHost(request.host)
        ? buildLocalRuntimeHostMessage(request.host)
        : TRANSCRIPTION_OFFLINE_MESSAGE,
    )
  } finally {
    globalThis.clearTimeout(timeoutId)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }

  let payload: TranscribePayload
  try {
    payload = (await response.json()) as TranscribePayload
  } catch {
    throw new Error(response.ok ? TRANSCRIPTION_SERVER_MESSAGE : describeResponseFailure(response, null))
  }

  if (!response.ok || payload.error) {
    throw new Error(describeResponseFailure(response, payload.error?.message ?? null))
  }

  const transcript = payload.data?.transcript?.trim() ?? ""
  if (!transcript) {
    throw new Error(EMPTY_RECORDING_MESSAGE)
  }

  return transcript
}
