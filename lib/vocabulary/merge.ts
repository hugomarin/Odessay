import type { VocabularyItem } from "@/lib/vocabulary/types"

export type VocabularyMergeResult = {
  /** The vocabulary that should exist after the merge, one row per (kind, key). */
  merged: VocabularyItem[]
  /** Items whose winning copy came from the cloud (or exist only there) — write locally. */
  localWrites: VocabularyItem[]
  /** Items whose winning copy came from local (or exist only there) — write to the cloud. */
  cloudWrites: VocabularyItem[]
}

function keyOf(item: VocabularyItem): string {
  return `${item.kind}:${item.key}`
}

/**
 * The vocabulary merge rule (ODE-473 requirement 6): union by (kind, key).
 * Same key with different content → the row with the greater `updatedAt`
 * wins. A local-only item is uploaded; a cloud-only item is downloaded. Base
 * items never duplicate — they share the same key on both sides, so they
 * fall into the "same key" branch like any other item.
 *
 * Pure and side-effect free. Idempotent: called twice with the same inputs
 * (or with local/cloud already converged from a previous merge) produces
 * `localWrites: []` and `cloudWrites: []` the second time, because every
 * common item then has an identical `updatedAt`.
 */
export function mergeVocabulary(local: VocabularyItem[], cloud: VocabularyItem[]): VocabularyMergeResult {
  const byKey = new Map<string, { local?: VocabularyItem; cloud?: VocabularyItem }>()

  for (const item of local) {
    const k = keyOf(item)
    byKey.set(k, { ...byKey.get(k), local: item })
  }
  for (const item of cloud) {
    const k = keyOf(item)
    byKey.set(k, { ...byKey.get(k), cloud: item })
  }

  const merged: VocabularyItem[] = []
  const localWrites: VocabularyItem[] = []
  const cloudWrites: VocabularyItem[] = []

  for (const entry of byKey.values()) {
    const { local: l, cloud: c } = entry

    if (l && c) {
      if (l.updatedAt === c.updatedAt) {
        merged.push(l)
        continue
      }
      const localIsNewer = Date.parse(l.updatedAt) > Date.parse(c.updatedAt)
      const winner = localIsNewer ? l : c
      merged.push(winner)
      if (localIsNewer) {
        cloudWrites.push(winner)
      } else {
        localWrites.push(winner)
      }
      continue
    }

    if (l && !c) {
      merged.push(l)
      cloudWrites.push(l)
      continue
    }

    if (c && !l) {
      merged.push(c)
      localWrites.push(c)
    }
  }

  return { merged, localWrites, cloudWrites }
}
