import type { CatalogChange } from "@/lib/services/contracts/document-catalog"

/**
 * WATCH-07 — what the currently-open editor must do when the watcher/
 * reconciler/catalog chain reports that the backing file's content changed
 * externally. Pure and runtime-neutral so the policy itself — auto-reload
 * when safe, conflict when not, and which `CatalogChange`s even count as
 * "external" in the first place — is testable without any editor, DOM, or
 * filesystem involved; `editor-shell.tsx` only wires this decision to real
 * effects (re-reading the file, showing UI).
 *
 * Policy (decided explicitly, not inferred):
 * - CLEAN (no pending local edit): auto-reload. Nothing of the user's is at
 *   risk, so silently keeping stale content is strictly worse than adopting
 *   the external version.
 * - DIRTY (a local edit is pending): conflict. Never auto-reload over an
 *   unsaved edit, and never let that edit auto-save over the external one —
 *   the write-side content-hash precondition in write_file (Rust) is what
 *   actually enforces the second half; this function only decides when to
 *   surface the conflict to the user.
 */

/**
 * Only a real watcher/reconciler pass over the filesystem is evidence of an
 * *external* change — `applyReconcileTransaction` always emits this exact
 * reason. The app's own saves emit "content" (body-only) or "upsert"
 * (metadata) for the very same document; treating those as external would
 * make the editor "detect" and react to its own successful autosave.
 */
const EXTERNAL_RECONCILIATION_REASONS: ReadonlySet<CatalogChange["reason"]> = new Set(["bulk"])

export function isExternalReconciliationReason(reason: CatalogChange["reason"] | undefined): boolean {
  return reason !== undefined && EXTERNAL_RECONCILIATION_REASONS.has(reason)
}

export type ExternalContentChangeDecision =
  | { action: "none" }
  | { action: "auto-reload" }
  | { action: "conflict" }

export type ExternalContentChangeInput = {
  /** The content hash the editor believes is currently durable on disk. */
  baselineContentHash: string | null
  /** The content hash the catalog currently reports for this document. */
  currentContentHash: string | null
  /** Whether this document has an unsaved local edit right now. */
  hasPendingLocalEdit: boolean
  /**
   * The `CatalogChange.reason` this decision is being evaluated for, or
   * `undefined` for a direct (non-event-driven) call such as the initial
   * sync right after opening a document. `undefined` is treated the same
   * as a non-external reason — the initial sync's job is only to seed the
   * baseline, never to react, and its caller enforces that separately.
   */
  reason?: CatalogChange["reason"]
}

/**
 * "Is there local content not yet confirmed durable?" is NOT the same
 * question as "does PersistenceCoordinator.hasPending() say a write is in
 * flight/queued?" — the desktop debounce (150ms rich mode,
 * MARKDOWN_SAVE_DEBOUNCE_MS in markdown mode) means there is a real window
 * after a keystroke where the editor already holds an unconfirmed edit but
 * no persist request has reached the coordinator yet at all, so
 * `hasPending()` alone would (correctly, from its own narrower perspective)
 * still say "nothing pending" — silently letting an external CLEAN
 * auto-reload discard that edit. `editor-shell.tsx` tracks the "has the
 * editor changed since the durable baseline" half itself (set the instant
 * a real edit happens, in TipTap's own `onUpdate` and the markdown-mode
 * equivalents; cleared the instant that content is actually handed to
 * `persist()`, at which point `hasPending()` becomes authoritative) and
 * combines it here rather than inline, so the combination itself — not just
 * `resolveExternalContentChange`'s later branching on it — is a named,
 * tested contract.
 */
export function computeHasPendingLocalEdit(input: {
  hasUnconfirmedLocalEdit: boolean
  hasPendingPersistence: boolean
}): boolean {
  return input.hasUnconfirmedLocalEdit || input.hasPendingPersistence
}

export function resolveExternalContentChange(
  input: ExternalContentChangeInput,
): ExternalContentChangeDecision {
  const { baselineContentHash, currentContentHash, hasPendingLocalEdit, reason } = input

  if (!isExternalReconciliationReason(reason)) {
    return { action: "none" }
  }

  // No baseline yet (still initializing) or the catalog has no hash at all
  // (e.g. a binding without a materialized file) — nothing to compare.
  if (!baselineContentHash || !currentContentHash) {
    return { action: "none" }
  }

  if (currentContentHash === baselineContentHash) {
    return { action: "none" }
  }

  return { action: hasPendingLocalEdit ? "conflict" : "auto-reload" }
}
