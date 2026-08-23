import type { OpenDocumentByIdRetryOptions, OpenDocumentByIdRetryOutcome } from "@/lib/services/open-document-factory"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { ServiceResponse } from "@/lib/services/contracts/service-types"
import type { WritingRecord } from "@/lib/services/contracts/document-service"
import {
  createEditorHydrationRecord,
  type EditorHydrationRecord,
  type HydrationLocalMetadata,
} from "@/lib/editor/document-hydration"

/**
 * ODE-455 — pure decision core of the desktop hydration path (ODE-452/454
 * scope): given a target writing id, resolve identity through the unified
 * opener with its retry/backoff, then read the document. No React, router,
 * SQLite, IndexedDB, Supabase or filesystem here — those are the injected
 * `HydrationCoordinatorDeps`, supplied by the runtime adapter (editor-shell).
 *
 * Behavior-preserving extraction: every branch mirrors the inline logic that
 * previously lived in editor-shell.tsx's main hydration effect, including the
 * asymmetry between a `NOT_FOUND` `openWriting` error (recoverable/visible,
 * "unavailable") and any other `openWriting` error (silently logged, state
 * left untouched) — that asymmetry is pre-existing behavior this issue does
 * not fix, only relocates.
 */

export type HydrationCoordinatorDeps = {
  isDesktopRuntime: () => boolean
  isUnifiedOpenEnabled: () => boolean
  isCancelled: () => boolean
  openDocumentByIdWithRetry: (
    id: string,
    options: OpenDocumentByIdRetryOptions,
  ) => Promise<OpenDocumentByIdRetryOutcome>
  openWriting: (id: string) => Promise<ServiceResponse<WritingRecord>>
  /**
   * Local metadata fallback used only when no catalog record resolved the
   * document (web, or desktop without the unified opener). Structurally
   * typed to the three fields actually read — not the full `localDB` schema
   * — so this boundary does not depend on IndexedDB/SQLite as a storage
   * concept, only on a shape any adapter can satisfy.
   */
  getLocalWriting: (id: string) => Promise<HydrationLocalMetadata | null>
}

export type HydrationOutcome =
  /** Cancelled before or during resolution (unmount/document switch) — abort silently, no state change. */
  | { status: "cancelled" }
  /**
   * The unified opener classified the document as unrecoverable on this
   * machine (orphaned, or a terminal/retry-exhausted `failed`), or the
   * document service reported `NOT_FOUND`. The caller must recover the tab
   * without persisting a new draft. `source` distinguishes which layer
   * classified it, matching the two distinct log sites in the original
   * inline code (the unified-open path additionally logs status/attempt;
   * the `NOT_FOUND` path only logs through `recoverUnavailableTab`).
   */
  | { status: "unavailable"; source: "unified-open"; openStatus: "orphaned" | "failed"; reasonCode: string; attempt: number }
  | { status: "unavailable"; source: "not-found" }
  /**
   * `openWriting` failed with something other than `NOT_FOUND`. Pre-existing
   * behavior: only logged, no tab recovery, no state change — preserved as-is.
   */
  | { status: "open-error"; error: unknown }
  /** Content resolved and ready to apply to the editor. */
  | { status: "hydrated"; record: EditorHydrationRecord }

export async function resolveHydrationOutcome(
  targetWritingId: string,
  deps: HydrationCoordinatorDeps,
): Promise<HydrationOutcome> {
  try {
    let catalogRecord: DocumentCatalogRecord | null = null

    if (deps.isDesktopRuntime() && deps.isUnifiedOpenEnabled()) {
      const { result: outcome, attempt } = await deps.openDocumentByIdWithRetry(targetWritingId, {
        isCancelled: deps.isCancelled,
      })
      if (deps.isCancelled()) {
        return { status: "cancelled" }
      }
      if (outcome.status === "orphaned" || outcome.status === "failed") {
        const reasonCode = outcome.status === "failed" ? outcome.reasonCode : "orphaned"
        return { status: "unavailable", source: "unified-open", openStatus: outcome.status, reasonCode, attempt }
      }
      if (outcome.status === "opened" || outcome.status === "conflict") {
        catalogRecord = outcome.record
      }
    }

    const openResult: ServiceResponse<WritingRecord> = await deps.openWriting(targetWritingId)
    if (openResult.error) {
      if (openResult.error.code === "NOT_FOUND") {
        return { status: "unavailable", source: "not-found" }
      }
      return { status: "open-error", error: openResult.error }
    }

    const localMetadata = await deps.getLocalWriting(targetWritingId)
    const record = createEditorHydrationRecord(openResult.data, { catalogRecord, localMetadata })
    return { status: "hydrated", record }
  } catch (error) {
    return { status: "open-error", error }
  }
}
