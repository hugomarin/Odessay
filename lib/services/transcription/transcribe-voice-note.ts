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
export async function transcribeVoiceNote(blob: Blob): Promise<string> {
  const formData = new FormData()
  formData.set("audio", blob, "voice-note.webm")

  let response: Response

  if (isTauriRuntime()) {
    const token = await getBearerToken()
    if (!token) {
      throw new Error("No active session.")
    }

    response = await fetch(`${getWebRuntimeBaseUrl()}/api/margins/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: formData,
    })
  } else {
    response = await fetch("/api/margins/transcribe", {
      method: "POST",
      body: formData,
    })
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
    throw new Error("No transcript was returned for this recording.")
  }

  return transcript
}
