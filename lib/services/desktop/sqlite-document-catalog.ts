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
  tauriCatalogDetachLocalFile,
  tauriCatalogDualWrite,
  tauriCatalogGetById,
  tauriCatalogList,
  tauriCatalogResolvePath,
  type DesktopCatalogDualWriteInput,
  type DesktopCatalogRow,
} from "@/lib/services/desktop/tauri-commands"

function toRecord(row: DesktopCatalogRow): DocumentCatalogRecord {
  return {
    id: row.id, localPresent: row.localPresent, cloudPresent: row.cloudPresent,
    cloudAccountId: row.cloudAccountId, syncStatus: row.syncStatus as DocumentCatalogRecord["syncStatus"],
    title: row.title, slug: row.slug, status: row.status as DocumentCatalogRecord["status"],
    artifactType: row.artifactType as DocumentCatalogRecord["artifactType"],
    visibility: row.visibility as DocumentCatalogRecord["visibility"], version: row.version,
    createdAt: row.createdAt, modifiedAt: row.modifiedAt,
    binding: row.canonicalPath && row.bindingRootId && row.relativePath ? {
      documentId: row.id, bindingRootId: row.bindingRootId, relativePath: row.relativePath,
      canonicalPath: row.canonicalPath, inode: row.inode, contentHash: row.contentHash,
      size: row.size, lastSeenAt: row.lastSeenAt,
    } : null,
  }
}

export class SqliteDocumentCatalog implements DocumentCatalog {
  private listeners = new Set<(change: CatalogChange) => void>()
  constructor(readonly dbPath: string) {}

  subscribe(listener: (change: CatalogChange) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(documentIds: string[], reason: CatalogChange["reason"]) {
    const change = { transactionId: crypto.randomUUID(), documentIds, reason, occurredAt: Date.now() } satisfies CatalogChange
    this.listeners.forEach((listener) => listener(change))
  }
  async getById(id: string) { const row = await tauriCatalogGetById(this.dbPath, id); return row ? toRecord(row) : null }
  async resolvePath(path: string): Promise<PathResolution> { const row = await tauriCatalogResolvePath(this.dbPath, path); return row ? { kind: "resolved", record: toRecord(row) } : { kind: "unbound", path } }
  async list(query?: DocumentCatalogQuery) { return (await tauriCatalogList(this.dbPath, query)).map(toRecord) }
  async registerBinding(input: RegisterBindingInput) {
    const { document: catalogDocument } = input
    const documentId = catalogDocument.id
    await tauriCatalogDualWrite(this.dbPath, toDualWriteInput(input))
    this.emit([documentId], "upsert")
    return (await this.getById(documentId))!
  }
  async detachLocalFile(id: string) { await tauriCatalogDetachLocalFile(this.dbPath, id); this.emit([id], "detach") }
  async applyCloudSnapshot(snapshot: CloudDocumentSnapshot) {
    await tauriCatalogDualWrite(this.dbPath, { document: { ...snapshot, localPresent: snapshot.localPresent ?? false }, binding: null, mutation: null })
    this.emit([snapshot.id], "cloud-snapshot")
  }

  async commitDualWrite(input: DesktopCatalogDualWriteInput): Promise<void> {
    const { document: catalogDocument } = input
    const documentId = catalogDocument.id
    await tauriCatalogDualWrite(this.dbPath, input)
    this.emit([documentId], "upsert")
  }
}

function toDualWriteInput(input: RegisterBindingInput): DesktopCatalogDualWriteInput {
  const rootPath = input.binding.canonicalPath.slice(0, -(input.binding.relativePath.length + 1))
  return {
    document: input.document,
    binding: { ...input.binding, rootPath, manifestVersion: 2, visibleAsWorkspace: false },
    mutation: null,
  }
}
