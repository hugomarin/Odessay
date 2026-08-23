import type { LocalSyncStatus, WritingLifecycle } from "@/lib/local-db/schema"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
import type { WritingRecord } from "@/lib/services/contracts/document-service"

export type EditorHydrationRecord = {
  writing: WritingRecord
  canonicalPath: string | null
  lifecycle: WritingLifecycle
  syncStatus: LocalSyncStatus
}

/**
 * The only fields this module reads off a local-metadata fallback, defined
 * as its own standalone shape — not derived from `LocalWriting` (e.g. via
 * `Pick`), not importing `WritingLifecycle`/`LocalSyncStatus` from the
 * storage schema module, and not using the storage column names
 * (`canonical_path`/`sync_status`). A caller backed by IndexedDB/SQLite must
 * translate its row into this shape explicitly (camelCase, domain-neutral
 * field names) rather than a `LocalWriting` merely happening to satisfy it
 * structurally — that structural-only decoupling was the gap the previous
 * round of review flagged.
 */
export type HydrationLocalMetadata = {
  canonicalPath?: string | null
  lifecycle: "local-only" | "syncing" | "server-confirmed"
  syncStatus: "synced" | "pending" | "failed" | "deleted"
}

const catalogSyncStatus = (record: DocumentCatalogRecord): LocalSyncStatus => {
  switch (record.syncStatus) {
    case "pending":
      return "pending"
    case "failed":
    case "conflict":
      return "failed"
    case "deleted":
      return "deleted"
    case "local-only":
    case "synced":
    default:
      return "synced"
  }
}

/**
 * Adapts an opened document for EditorShell without changing content authority.
 *
 * DocumentService owns the body snapshot. SQLite catalog state owns desktop
 * presence/binding metadata. IndexedDB is only a transitional metadata fallback
 * for web and older desktop data; its body must never replace an opened `.md`.
 */
export const createEditorHydrationRecord = (
  writing: WritingRecord,
  options: {
    catalogRecord?: DocumentCatalogRecord | null
    localMetadata?: HydrationLocalMetadata | null
  } = {},
): EditorHydrationRecord => {
  const { catalogRecord, localMetadata } = options
  const hydratedWriting = (() => {
    if (writing.content.richText || writing.content.markdown == null) return writing

    const snapshot = parseMarkdownToSnapshot(writing.content.markdown)
    return {
      ...writing,
      content: {
        ...writing.content,
        richText: snapshot.bodyJson,
        plainText: snapshot.bodyText,
      },
    }
  })()

  if (catalogRecord) {
    return {
      writing: hydratedWriting,
      canonicalPath: catalogRecord.binding?.canonicalPath ?? null,
      lifecycle: catalogRecord.cloudPresent ? "server-confirmed" : "local-only",
      syncStatus: catalogSyncStatus(catalogRecord),
    }
  }

  return {
    writing: hydratedWriting,
    canonicalPath: localMetadata?.canonicalPath ?? null,
    lifecycle: localMetadata?.lifecycle ?? "local-only",
    syncStatus: localMetadata?.syncStatus ?? "synced",
  }
}
