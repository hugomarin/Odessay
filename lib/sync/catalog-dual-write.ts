import type { LocalWriting, WritingSyncMutation } from "@/lib/local-db/schema"
import { isDesktopCatalogDualWriteEnabled } from "@/lib/services/desktop/catalog-feature-flag"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import type { DesktopCatalogDualWriteInput } from "@/lib/services/desktop/tauri-commands"
import { tauriCatalogDetachLocalFile, tauriCatalogUpdateMutationStatus } from "@/lib/services/desktop/tauri-commands"

export type CatalogDualWriteMetric = {
  operation: "upsert" | "delete"
  success: boolean
  durationMs: number
  documentId: string
  errorCode?: "CATALOG_TRANSACTION_FAILED"
}

let catalogPromise: Promise<SqliteDocumentCatalog> | null = null
const metricListeners = new Set<(metric: CatalogDualWriteMetric) => void>()

export function subscribeToCatalogDualWriteMetrics(listener: (metric: CatalogDualWriteMetric) => void) {
  metricListeners.add(listener)
  return () => metricListeners.delete(listener)
}

function emitMetric(metric: CatalogDualWriteMetric) {
  metricListeners.forEach((listener) => listener(metric))
}

async function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [{ appConfigDir, join }] = await Promise.all([import("@tauri-apps/api/path")])
      return new SqliteDocumentCatalog(await join(await appConfigDir(), "desktop-index.sqlite3"))
    })()
  }
  return catalogPromise
}

function splitCanonicalPath(path: string) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator < 0
    ? { rootPath: ".", relativePath: path }
    : { rootPath: path.slice(0, separator), relativePath: path.slice(separator + 1) }
}

function toInput(writing: LocalWriting, mutation: WritingSyncMutation): DesktopCatalogDualWriteInput {
  const canonicalPath = writing.canonical_path?.trim() || null
  const pathParts = canonicalPath ? splitCanonicalPath(canonicalPath) : null
  return {
    document: {
      id: writing.id,
      localPresent: Boolean(canonicalPath),
      cloudPresent: writing.lifecycle === "server-confirmed",
      cloudAccountId: writing.author_id ?? null,
      syncStatus: "pending",
      title: writing.title ?? null,
      slug: writing.slug ?? null,
      status: writing.status,
      artifactType: writing.artifact_type ?? "general",
      visibility: writing.visibility,
      version: writing.version,
      createdAt: Date.parse(writing.created_at),
      modifiedAt: Date.parse(writing.updated_at),
    },
    binding: canonicalPath && pathParts ? {
      bindingRootId: `legacy-root:${pathParts.rootPath}`,
      rootPath: pathParts.rootPath,
      manifestVersion: 1,
      visibleAsWorkspace: false,
      relativePath: pathParts.relativePath,
      canonicalPath,
      inode: null,
      contentHash: writing.content_hash ?? null,
      size: null,
      lastSeenAt: writing.local_updated_at,
    } : null,
    mutation: {
      id: mutation.id,
      operation: mutation.operation,
      payloadJson: JSON.stringify(mutation.payload),
      status: "pending",
      attemptCount: mutation.attempts,
      nextRetryAt: mutation.next_retry_at ?? null,
      createdAt: mutation.created_at,
      lastError: mutation.last_error ?? null,
    },
  }
}

export function scheduleDesktopCatalogDualWrite(writing: LocalWriting, mutation: WritingSyncMutation): void {
  if (!isDesktopRuntime() || !isDesktopCatalogDualWriteEnabled()) return
  const startedAt = performance.now()
  void getCatalog().then((catalog) => catalog.commitDualWrite(toInput(writing, mutation))).then(() => {
    emitMetric({ operation: mutation.operation, success: true, durationMs: performance.now() - startedAt, documentId: writing.id })
  }).catch((error) => {
    const metric: CatalogDualWriteMetric = {
      operation: mutation.operation,
      success: false,
      durationMs: performance.now() - startedAt,
      documentId: writing.id,
      errorCode: "CATALOG_TRANSACTION_FAILED",
    }
    emitMetric(metric)
    console.error("[catalog:dual-write]", { ...metric, error: error instanceof Error ? error.message : "Unknown catalog failure" })
  })
}

export function scheduleDesktopCatalogDetach(documentId: string): void {
  if (!isDesktopRuntime() || !isDesktopCatalogDualWriteEnabled()) return
  void getCatalog().then((catalog) => tauriCatalogDetachLocalFile(catalog.dbPath, documentId)).catch((error) => {
    console.error("[catalog:dual-write]", { documentId, operation: "detach", errorCode: "CATALOG_TRANSACTION_FAILED", error: error instanceof Error ? error.message : "Unknown catalog failure" })
  })
}

export function scheduleDesktopCatalogMutationStatus(
  mutation: WritingSyncMutation,
  status: "pending" | "synced" | "failed",
  nextRetryAt: number | null = null,
  lastError: string | null = null,
): void {
  if (!isDesktopRuntime() || !isDesktopCatalogDualWriteEnabled()) return
  void getCatalog().then((catalog) => tauriCatalogUpdateMutationStatus(
    catalog.dbPath, mutation.id, status, mutation.attempts + (status === "failed" ? 1 : 0), nextRetryAt, lastError,
  )).catch((error) => {
    console.error("[catalog:dual-write]", { documentId: mutation.entity_id, operation: "retry", errorCode: "CATALOG_TRANSACTION_FAILED", error: error instanceof Error ? error.message : "Unknown catalog failure" })
  })
}
