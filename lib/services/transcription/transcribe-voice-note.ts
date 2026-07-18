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

function getWebRuntimeBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured")
  }
  return url.replace(/\/$/, "")
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

  let response: Response

  try {
    if (isTauriRuntime()) {
      const token = await getBearerToken()
      if (!token) {
        throw new Error("No active session.")
      }

      response = await fetch(`${getWebRuntimeBaseUrl()}/api/margins/transcribe`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
        signal: abortController.signal,
      })
    } else {
      response = await fetch("/api/margins/transcribe", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      })
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      if (options.signal?.aborted) {
        throw new DOMException("Transcription cancelled.", "AbortError")
      }
      throw new Error("Transcription timed out. Try again.")
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeoutId)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }

  let payload: TranscribePayload
  try {
    payload = (await response.json()) as TranscribePayload
  } catch {
    throw new Error("Transcription failed.")
  }

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? "Transcription failed.")
  }

  const transcript = payload.data?.transcript?.trim() ?? ""
  if (!transcript) {
    throw new Error(EMPTY_RECORDING_MESSAGE)
  }

  return transcript
}
