import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import type { OpenDocumentResult } from "@/lib/services/open-document"

/**
 * The unified opener (ODE-375 M3) is part of the Fase 9 catalog pipeline, so it is
 * the single desktop opener after the ODE-374 compatibility retirement.
 */
export function isUnifiedOpenEnabled(): boolean {
  return isDesktopRuntime()
}

/** Opens a document through the catalog-backed unified opener. Desktop only. */
export async function openDocumentByPath(
  path: string,
  options: { confirmRegisterRoot?: boolean } = {},
): Promise<OpenDocumentResult> {
  const { openDesktopDocument } = await import(
    "@/lib/services/desktop/open-document-desktop"
  )
  return openDesktopDocument({
    kind: "path",
    path,
    confirmRegisterRoot: options.confirmRegisterRoot ?? false,
  })
}

/** Opens a document by UUID through the catalog-backed unified opener. */
export async function openDocumentById(id: string): Promise<OpenDocumentResult> {
  const { openDesktopDocument } = await import(
    "@/lib/services/desktop/open-document-desktop"
  )
  return openDesktopDocument({ kind: "id", id })
}

const RETRY_MAX_ATTEMPTS = 4
const RETRY_BASE_DELAY_MS = 400
const RETRY_MAX_DELAY_MS = 4000

/**
 * Bounded exponential backoff with jitter for attempt `attempt` (1-based).
 * Exported for tests — deterministic given a fixed `random`.
 */
export function computeOpenRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
  const jitter = exponential * 0.3 * random()
  return Math.round(exponential * 0.85 + jitter)
}

export type OpenDocumentByIdRetryOptions = {
  /** 1 initial attempt + retries. Defaults to 4 total attempts. */
  maxAttempts?: number
  /** Checked before the first attempt and after every wait; stops the loop. */
  isCancelled?: () => boolean
  wait?: (ms: number) => Promise<void>
  random?: () => number
}

export type OpenDocumentByIdRetryOutcome = {
  result: OpenDocumentResult
  attempt: number
}

/**
 * Rearms `openDocumentById` on a `failed retryable` outcome with a bounded
 * backoff + jitter, without any user interaction (ODE-454 requirement 3).
 * `orphaned` and `failed` with `retryable: false` return on the first attempt —
 * only a port-classified transient failure is retried. A cancellation check
 * (document switch/unmount) stops the loop before scheduling or after waking
 * from a wait so a stale attempt never resolves onto a newer document
 * (requirement 6).
 */
export async function openDocumentByIdWithRetry(
  id: string,
  options: OpenDocumentByIdRetryOptions = {},
): Promise<OpenDocumentByIdRetryOutcome> {
  const maxAttempts = options.maxAttempts ?? RETRY_MAX_ATTEMPTS
  const isCancelled = options.isCancelled ?? (() => false)
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random

  let attempt = 0
  let result: OpenDocumentResult
  for (;;) {
    attempt += 1
    result = await openDocumentById(id)
    if (isCancelled()) return { result, attempt }

    const shouldRetry = result.status === "failed" && result.retryable && attempt < maxAttempts
    if (!shouldRetry) return { result, attempt }

    await wait(computeOpenRetryDelayMs(attempt, random))
    if (isCancelled()) return { result, attempt }
  }
}

/** Human-readable, non-alarming message for a non-open outcome (no draft). */
export function describeOpenOutcome(result: OpenDocumentResult): string {
  switch (result.status) {
    case "ambiguous":
      return "This file matches more than one document. Pick which one to open."
    case "conflict":
      return "This document has local and cloud changes that conflict. Resolve them before editing."
    case "orphaned":
      return "This document is no longer available on disk or in the cloud."
    case "failed":
      return result.reason
    default:
      return "This document could not be opened."
  }
}
