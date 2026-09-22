/**
 * ODE-524 — shared, atomic per-account admission for every remote AI route.
 * Backed by Postgres (see 20260913200000_create_ai_admission_control.sql),
 * not process memory, so limits hold across every server instance and cold
 * start — a module-scoped Map was the explicitly rejected approach.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { getAdmissionConfig, type AiRouteKey } from "@/lib/ai/admission-config"

export type AdmissionResult =
  | { admitted: true; leaseId: string }
  | { admitted: false; reason: "rate_limited" | "concurrency_limited"; retryAfterSeconds: number }

type AdmissionRpcRow = {
  admitted: boolean
  lease_id: string | null
  retry_after_seconds: number
  reason: string
}

/**
 * Requirement 2: call this before any provider work. On rejection, the
 * caller must return 429 with retry metadata and must not call the
 * provider at all.
 */
export async function tryAcquireAiAdmission(params: {
  accountId: string
  routeKey: AiRouteKey
}): Promise<AdmissionResult> {
  const config = getAdmissionConfig()
  const routeConfig = config.routes[params.routeKey]

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("ai_admission_try_acquire", {
    p_account_id: params.accountId,
    p_route_key: params.routeKey,
    p_window_seconds: routeConfig.windowSeconds,
    p_rate_limit: routeConfig.rateLimit,
    p_concurrency_limit: config.concurrencyLimit,
    p_lease_seconds: config.leaseSeconds,
  })

  if (error) {
    // Requirement: an admission-store outage must not silently become
    // unlimited access. Fail closed with a retryable rejection rather than
    // letting the request through uncounted.
    logAiAdmissionEvent({ event: "admission_store_error", routeKey: params.routeKey, message: error.message })
    return { admitted: false, reason: "concurrency_limited", retryAfterSeconds: 5 }
  }

  const row = (Array.isArray(data) ? data[0] : data) as AdmissionRpcRow | undefined
  if (!row || !row.admitted) {
    const reason = row?.reason === "rate_limited" ? "rate_limited" : "concurrency_limited"
    logAiAdmissionEvent({ event: "rejected", routeKey: params.routeKey, reason })
    return { admitted: false, reason, retryAfterSeconds: row?.retry_after_seconds ?? 1 }
  }

  logAiAdmissionEvent({ event: "admitted", routeKey: params.routeKey })
  return { admitted: true, leaseId: row.lease_id as string }
}

/**
 * Always call from a `finally` around the provider work — success, failure,
 * or timeout must all release the lease so the concurrency ceiling doesn't
 * stay artificially full. Deleting an already-expired/-released lease is a
 * documented no-op (see the migration), so this never throws.
 */
export async function releaseAiAdmission(leaseId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.rpc("ai_admission_release", { p_lease_id: leaseId })
  if (error) {
    // An unreleased lease self-heals via expires_at — log, don't throw, so a
    // release failure never masks the actual request outcome to the caller.
    logAiAdmissionEvent({ event: "release_error", message: error.message })
  }
}

/**
 * Requirement 7: privacy-safe structured metrics. Never pass request/prompt
 * content, transcript text, or the audio blob itself — only route, outcome
 * and the account id (already an opaque internal UUID, not raw PII).
 */
export function logAiAdmissionEvent(event: {
  event: "admitted" | "rejected" | "timeout" | "provider_error" | "admission_store_error" | "release_error"
  routeKey?: AiRouteKey
  reason?: string
  message?: string
}): void {
  console.info("[ai:admission]", event)
}
