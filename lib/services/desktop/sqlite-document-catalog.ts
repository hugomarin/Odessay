import type {
  CatalogChange,
  CloudDocumentSnapshot,
  DocumentCatalog,
  DocumentCatalogQuery,
  DocumentCatalogRecord,
  PathResolution,
  RegisterBindingInput,
} from "@/lib/services/contracts/document-catalog"
import {
  tauriCatalogApplyReconcile,
  tauriCatalogApplyCloudSnapshots,
  tauriCatalogApplyWorkspaceRemoval,
  tauriCatalogActivateBindingRoot,
  tauriCatalogBulkDualWrite,
  tauriCatalogCountBindingRootDocuments,
  tauriCatalogListBindingRootDocuments,
  tauriCatalogListRetiredBindingRoots,
  tauriCatalogReactivateBindingRoot,
  tauriCatalogDetachLocalFile,
  tauriCatalogDualWrite,
  tauriCatalogGetById,
  tauriCatalogHydrateExcerpts,
  tauriCatalogList,
  tauriCatalogResolvePath,
  type DesktopCatalogDualWriteInput,
  type DesktopCatalogRow,
  type DesktopRetiredBindingRoot,
} from "@/lib/services/desktop/tauri-commands"
import type { ReconcileCommit } from "@/lib/services/desktop/workspace-reconciler"
import { filenameToTitle, splitCanonicalPath } from "@/lib/desktop/document-naming"

function toRecord(row: DesktopCatalogRow): DocumentCatalogRecord {
  return {
    id: row.id, localPresent: row.localPresent, cloudPresent: row.cloudPresent,
    cloudAccountId: row.cloudAccountId, syncStatus: row.syncStatus as DocumentCatalogRecord["syncStatus"],
    title: row.title, slug: row.slug, status: row.status as DocumentCatalogRecord["status"],
    artifactType: row.artifactType as DocumentCatalogRecord["artifactType"],
    visibility: row.visibility as DocumentCatalogRecord["visibility"], version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt, modifiedAt: row.modifiedAt,
    excerpt: row.excerptContentHash && row.excerptContentHash === row.contentHash
      ? row.excerpt
      : null,
    binding: row.canonicalPath && row.bindingRootId && row.relativePath ? {
      documentId: row.id, bindingRootId: row.bindingRootId, relativePath: row.relativePath,
      canonicalPath: row.canonicalPath, inode: row.inode, contentHash: row.contentHash,
      size: row.size, lastSeenAt: row.lastSeenAt,
    } : null,
  }
}

const listenersByDatabase = new Map<string, Set<(change: CatalogChange) => void>>()
const excerptHydrationsByDatabase = new Map<string, Promise<void>>()

function listenersFor(dbPath: string) {
  let listeners = listenersByDatabase.get(dbPath)
  if (!listeners) {
    listeners = new Set()
    listenersByDatabase.set(dbPath, listeners)
  }
  return listeners
}

export class SqliteDocumentCatalog implements DocumentCatalog {
  constructor(readonly dbPath: string) {}

  subscribe(listener: (change: CatalogChange) => void) {
    const listeners = listenersFor(this.dbPath)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) listenersByDatabase.delete(this.dbPath)
    }
  }
  private emit(documentIds: string[], reason: CatalogChange["reason"]) {
    const change = { transactionId: crypto.randomUUID(), documentIds, reason, occurredAt: Date.now() } satisfies CatalogChange
    listenersByDatabase.get(this.dbPath)?.forEach((listener) => listener(change))
  }
  async getById(id: string) { const row = await tauriCatalogGetById(this.dbPath, id); return row ? toRecord(row) : null }
  async resolvePath(path: string): Promise<PathResolution> { const row = await tauriCatalogResolvePath(this.dbPath, path); return row ? { kind: "resolved", record: toRecord(row) } : { kind: "unbound", path } }
  async list(query?: DocumentCatalogQuery) {
    const records = (await tauriCatalogList(this.dbPath, query))
      .map(toRecord)
      .filter((record) => record.localPresent || record.cloudPresent || (query?.includeDeleted && record.deletedAt))
    this.scheduleExcerptHydration()
    return records
  }
  private scheduleExcerptHydration() {
    if (excerptHydrationsByDatabase.has(this.dbPath)) return
    const hydration = tauriCatalogHydrateExcerpts(this.dbPath)
      .then((documentIds) => {
        if (documentIds.length > 0) this.emit(documentIds, "bulk")
      })
      .catch(() => {
        // A missing/unreadable file must not hide the catalog row or erase a
        // previously valid cache. The next catalog load may retry.
      })
      .finally(() => excerptHydrationsByDatabase.delete(this.dbPath))
    excerptHydrationsByDatabase.set(this.dbPath, hydration)
  }
  async registerBinding(input: RegisterBindingInput) {
    const { document: catalogDocument } = input
    const documentId = catalogDocument.id
    await tauriCatalogDualWrite(this.dbPath, toDualWriteInput(input))
    this.emit([documentId], "upsert")
    return (await this.getById(documentId))!
  }
  async detachLocalFile(id: string) { await tauriCatalogDetachLocalFile(this.dbPath, id); this.emit([id], "detach") }
  async applyCloudSnapshot(snapshot: CloudDocumentSnapshot) {
    await this.applyCloudSnapshots([snapshot])
  }

  async applyCloudSnapshots(snapshots: CloudDocumentSnapshot[]) {
    if (snapshots.length === 0) return
    await tauriCatalogApplyCloudSnapshots(
      this.dbPath,
      snapshots.map((snapshot) => ({
        id: snapshot.id,
        cloudPresent: snapshot.cloudPresent,
        cloudAccountId: snapshot.cloudAccountId,
        contentHash: snapshot.contentHash ?? null,
        title: snapshot.title,
        slug: snapshot.slug,
        status: snapshot.status,
        artifactType: snapshot.artifactType,
        visibility: snapshot.visibility,
        version: snapshot.version,
        deletedAt: snapshot.deletedAt,
        createdAt: snapshot.createdAt,
        modifiedAt: snapshot.modifiedAt,
      })),
    )
    this.emit(snapshots.map((snapshot) => snapshot.id), "cloud-snapshot")
  }

  async commitDualWrite(input: DesktopCatalogDualWriteInput): Promise<void> {
    const { document: catalogDocument } = input
    const documentId = catalogDocument.id
    await tauriCatalogDualWrite(this.dbPath, input)
    this.emit([documentId], "upsert")
  }

  async commitBulkDualWrite(inputs: DesktopCatalogDualWriteInput[]): Promise<void> {
    if (inputs.length === 0) return
    await tauriCatalogBulkDualWrite(this.dbPath, inputs)
    const documentIds = inputs.map(({ document: catalogRecord }) => catalogRecord.id)
    this.emit(documentIds, "bulk")
  }

  async countByBindingRoot(bindingRootId: string): Promise<{ total: number; cloud: number }> {
    return tauriCatalogCountBindingRootDocuments(this.dbPath, bindingRootId)
  }

  async listByBindingRoot(bindingRootId: string): Promise<DocumentCatalogRecord[]> {
    return (await tauriCatalogListBindingRootDocuments(this.dbPath, bindingRootId)).map(toRecord)
  }

  async listRetiredBindingRoots(): Promise<DesktopRetiredBindingRoot[]> {
    return tauriCatalogListRetiredBindingRoots(this.dbPath)
  }

  async activateBindingRoot(bindingRootId: string, rootPath: string): Promise<void> {
    await tauriCatalogActivateBindingRoot(this.dbPath, bindingRootId, rootPath)
  }

  /**
   * Re-adding a previously removed workspace folder (ODE-408).
   *
   * Restores local-only documents to the active catalog in SQLite and returns
   * only the ones that were archived *in cloud* and whose local `.md` is present
   * again — those still need the "local wins" content upsert, which the caller
   * applies through the normal dual-write path.
   *
   * A local-only document is never returned here: it has no cloud row, so
   * re-adding its folder must not enqueue anything toward Supabase.
   */
  async reactivateBindingRoot(bindingRootId: string): Promise<DocumentCatalogRecord[]> {
    const rows = await tauriCatalogReactivateBindingRoot(this.dbPath, bindingRootId)
    return rows.map(toRecord)
  }

  /**
   * Remove an entire BindingRoot from the active catalog (ODE-408).
   * Local-only documents are detached and hidden; cloud documents are soft-deleted
   * and queued for sync. Files and `.odessay/index.json` on disk are untouched.
   */
  async applyWorkspaceRemoval(
    bindingRootId: string,
    rootPath: string,
    deletedAt: string,
    updatedAt: string,
  ): Promise<CatalogChange> {
    const documentIds = await tauriCatalogApplyWorkspaceRemoval(
      this.dbPath,
      bindingRootId,
      rootPath,
      deletedAt,
      updatedAt,
    )
    const change = {
      transactionId: crypto.randomUUID(),
      documentIds,
      reason: "bulk",
      occurredAt: Date.now(),
    } satisfies CatalogChange
    if (documentIds.length > 0) {
      listenersByDatabase.get(this.dbPath)?.forEach((listener) => listener(change))
    }
    return change
  }

  /**
   * Single fan-out signal for the ODE-376 M5 IndexedDB→SQLite migration: the
   * migration commits each row idempotently without emitting, then calls this
   * once for the whole batch so subscribers refresh a single time rather than
   * once per row (Performance Contract: reactive fan-out).
   */
  notifyMigration(documentIds: string[]): void {
    if (documentIds.length === 0) return
    this.emit(documentIds, "migration")
  }

  /**
   * Apply one WorkspaceReconciler burst (ODE-370). Projects local bindings and
   * confirmed-absent detaches in a single SQLite transaction, then emits exactly
   * ONE CatalogChange for every document touched by the burst. Cloud metadata is
   * never written here — only local presence and the binding move.
   */
  async applyReconcileTransaction(commit: ReconcileCommit): Promise<CatalogChange> {
    const applied = await tauriCatalogApplyReconcile(this.dbPath, {
      upserts: commit.upserts.map((entry) => ({
        bindingRootId: commit.bindingRootId,
        rootPath: commit.rootPath,
        manifestVersion: 2,
        visibleAsWorkspace: commit.visibleAsWorkspace,
        documentId: entry.documentId!,
        relativePath: entry.relativePath,
        canonicalPath: entry.canonicalPath,
        inode: entry.inode,
        contentHash: entry.contentHash,
        size: entry.size,
        lastSeenAt: entry.modifiedAt,
        title: filenameToTitle(entry.relativePath),
        createdAt: entry.modifiedAt,
        modifiedAt: entry.modifiedAt,
      })),
      detached: commit.detached,
    })
    if (!applied) {
      return {
        transactionId: commit.transactionId,
        documentIds: [],
        reason: "bulk",
        occurredAt: Date.now(),
      }
    }
    const documentIds = [
      ...commit.upserts.map((entry) => entry.documentId!),
      ...commit.detached,
    ]
    const change = {
      transactionId: commit.transactionId,
      documentIds,
      reason: "bulk",
      occurredAt: Date.now(),
    } satisfies CatalogChange
    listenersByDatabase.get(this.dbPath)?.forEach((listener) => listener(change))
    return change
  }
}

function toDualWriteInput(input: RegisterBindingInput): DesktopCatalogDualWriteInput {
  const { rootPath } = splitCanonicalPath(input.binding.canonicalPath)
  return {
    document: input.document,
    binding: { ...input.binding, rootPath, manifestVersion: 2, visibleAsWorkspace: false },
    mutation: null,
  }
}
