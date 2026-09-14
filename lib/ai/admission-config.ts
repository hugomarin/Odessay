/**
 * ODE-524 — documented environment defaults for the shared AI admission
 * policy, with startup validation (requirement 5). A misconfigured limit
 * (zero, negative, non-numeric) fails loudly at the first read rather than
 * silently admitting unlimited traffic or rejecting everything.
 */

export type AiRouteKey = "title-suggestions" | "publication-review" | "transcription"

export type AdmissionRouteConfig = {
  routeKey: AiRouteKey
  rateLimit: number
  windowSeconds: number
}

export type AdmissionConfig = {
  routes: Record<AiRouteKey, AdmissionRouteConfig>
  concurrencyLimit: number
  leaseSeconds: number
}

export type AudioLimitsConfig = {
  maxBytes: number
  maxDurationSeconds: number
}

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar]
  if (raw === undefined || raw.trim() === "") return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envVar}: "${raw}" must be a positive integer.`)
  }
  return parsed
}

const WINDOW_SECONDS = 60

let cachedAdmissionConfig: AdmissionConfig | null = null

/** Requirement 5's documented initial defaults, each overridable by env var. */
export function getAdmissionConfig(): AdmissionConfig {
  if (cachedAdmissionConfig) return cachedAdmissionConfig

  cachedAdmissionConfig = {
    routes: {
      "title-suggestions": {
        routeKey: "title-suggestions",
        rateLimit: readPositiveInt("AI_QUOTA_TITLE_SUGGESTIONS_PER_MIN", 10),
        windowSeconds: WINDOW_SECONDS,
      },
      "publication-review": {
        routeKey: "publication-review",
        rateLimit: readPositiveInt("AI_QUOTA_PUBLICATION_REVIEW_PER_MIN", 5),
        windowSeconds: WINDOW_SECONDS,
      },
      transcription: {
        routeKey: "transcription",
        rateLimit: readPositiveInt("AI_QUOTA_TRANSCRIPTION_PER_MIN", 5),
        windowSeconds: WINDOW_SECONDS,
      },
    },
    concurrencyLimit: readPositiveInt("AI_QUOTA_CONCURRENCY_PER_ACCOUNT", 2),
    // The lease outlives the longest provider timeout in this codebase
    // (publication-review's 45s) with margin, so a genuinely slow-but-alive
    // request is never treated as abandoned while it's still running.
    leaseSeconds: readPositiveInt("AI_QUOTA_LEASE_SECONDS", 90),
  }

  return cachedAdmissionConfig
}

let cachedAudioLimitsConfig: AudioLimitsConfig | null = null

export function getAudioLimitsConfig(): AudioLimitsConfig {
  if (cachedAudioLimitsConfig) return cachedAudioLimitsConfig

  cachedAudioLimitsConfig = {
    maxBytes: readPositiveInt("AI_TRANSCRIPTION_MAX_AUDIO_BYTES", 10 * 1024 * 1024),
    maxDurationSeconds: readPositiveInt("AI_TRANSCRIPTION_MAX_AUDIO_SECONDS", 10 * 60),
  }

  return cachedAudioLimitsConfig
}

/** Test-only: forces the next getAdmissionConfig()/getAudioLimitsConfig() call to re-read env vars. */
export function resetAdmissionConfigCacheForTests(): void {
  cachedAdmissionConfig = null
  cachedAudioLimitsConfig = null
}
