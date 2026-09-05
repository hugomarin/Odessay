import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { listVocabulary as listCloudVocabulary, upsertVocabularyItemRows } from "@/lib/vocabulary/server"
import { mergeVocabulary } from "@/lib/vocabulary/merge"
import type { VocabularyItem } from "@/lib/vocabulary/types"

export type VocabularyReconciliationOutcome =
  | { status: "synced" }
  | { status: "pending"; reason: string }

function fingerprint(items: VocabularyItem[]): string {
  return items
    .map((i) => `${i.kind}:${i.key}:${i.updatedAt}:${i.hidden}`)
    .sort()
    .join("|")
}

/**
 * Runs the ODE-473 requirement 6 merge between the local (desktop_settings_v1)
 * and cloud (vocabulary_items) vocabularies for a signed-in user, and applies
 * the result to both sides. Called from `SyncBootstrap` on sign-in — see
 * `components/sync/sync-bootstrap.tsx`.
 *
 * Never blocks editing: any failure (network down, cloud read/write error)
 * leaves the local vocabulary exactly as it was and reports "pending" for the
 * caller to retry on the next signed-in session, per the failure modes in the
 * ODE-473 brief ("la nube no responde durante la reconciliación: el local
 * queda como está").
 *
 * Race with a concurrent user edit: the user's edit wins. This function
 * snapshots local at the start; if local changed by the time it is ready to
 * write, it retries the merge once against the fresh local snapshot. A
 * second collision aborts, leaving local untouched and reporting "pending" —
 * never overwrites an edit made while reconciling.
 */
export async function reconcileVocabularyOnSignIn(userId: string): Promise<VocabularyReconciliationOutcome> {
  try {
    const { appConfigDir } = await import("@tauri-apps/api/path")
    const settings = new DesktopSettingsService(await appConfigDir())
    const supabase = createDesktopClient()

    const cloudResult = await listCloudVocabulary(supabase, userId)
    if (cloudResult.error) {
      return { status: "pending", reason: cloudResult.error.message }
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const localResult = await settings.listVocabulary()
      if (localResult.error) {
        return { status: "pending", reason: localResult.error.message }
      }

      const snapshotFingerprint = fingerprint(localResult.data)
      const { localWrites, cloudWrites } = mergeVocabulary(localResult.data, cloudResult.data)

      if (localWrites.length === 0 && cloudWrites.length === 0) {
        return { status: "synced" }
      }

      if (localWrites.length > 0) {
        const beforeWrite = await settings.listVocabulary()
        if (beforeWrite.error) {
          return { status: "pending", reason: beforeWrite.error.message }
        }
        if (fingerprint(beforeWrite.data) !== snapshotFingerprint) {
          // Local changed underneath us. Retry once against the fresh state.
          continue
        }
        await settings.applyVocabularyMergeLocally(localWrites)
      }

      if (cloudWrites.length > 0) {
        const uploadError = await upsertVocabularyItemRows(supabase, userId, cloudWrites)
        if (uploadError) {
          return { status: "pending", reason: uploadError.message }
        }
      }

      return { status: "synced" }
    }

    return { status: "pending", reason: "Local vocabulary kept changing during reconciliation; will retry next session." }
  } catch (e) {
    return { status: "pending", reason: e instanceof Error ? e.message : "Vocabulary reconciliation failed" }
  }
}
