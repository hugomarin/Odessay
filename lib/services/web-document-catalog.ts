import { localDB, subscribeToLocalDBChanges } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import type {
  CatalogChange,
  CloudDocumentSnapshot,
  DocumentCatalog,
  DocumentCatalogQuery,
  DocumentCatalogRecord,
  PathResolution,
  RegisterBindingInput,
} from "@/lib/services/contracts/document-catalog"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"

function toCatalogRecord(writing: LocalWriting): DocumentCatalogRecord {
  const localPresent = Boolean(writing.canonical_path)
  const cloudPresent = writing.lifecycle === "server-confirmed"
  return {
    id: writing.id,
    localPresent,
    cloudPresent,
    cloudAccountId: cloudPresent ? writing.author_id ?? null : null,
    syncStatus: writing.sync_status === "synced" && !cloudPresent ? "local-only" : writing.sync_status,
    title: writing.title ?? null,
    slug: writing.slug ?? null,
    status: writing.status,
    artifactType: normalizeArtifactType(writing.artifact_type),
    visibility: writing.visibility,
    version: writing.version,
    deletedAt: writing.deleted_at ?? null,
    createdAt: Date.parse(writing.created_at),
    modifiedAt: Date.parse(writing.updated_at),
    binding: writing.canonical_path ? {
      documentId: writing.id,
      bindingRootId: "web-indexeddb-compat",
      relativePath: writing.canonical_path,
      canonicalPath: writing.canonical_path,
      inode: null,
      contentHash: writing.content_hash ?? null,
      size: null,
      lastSeenAt: writing.local_updated_at,
    } : null,
  }
}

export class WebDocumentCatalog implements DocumentCatalog {
  async getById(id: string) { const writing = await localDB.writings.get(id); return writing ? toCatalogRecord(writing) : null }
  async resolvePath(path: string): Promise<PathResolution> {
    const writing = await localDB.writings.getByCanonicalPath(path)
    return writing ? { kind: "resolved", record: toCatalogRecord(writing) } : { kind: "unbound", path }
  }
  async list(query: DocumentCatalogQuery = {}) {
    const writings = await localDB.writings.getAll({ includeDeleted: query.includeDeleted })
    return writings.map(toCatalogRecord).filter((record) => {
      if (query.localOnly && !record.localPresent) return false
      if (!record.localPresent && query.cloudAccountId !== undefined && record.cloudAccountId !== query.cloudAccountId) return false
      return true
    }).slice(0, query.limit ?? 200)
  }
  async registerBinding(input: RegisterBindingInput) {
    const writing = await localDB.writings.get(input.document.id)
    if (!writing) throw new Error(`Writing ${input.document.id} not found`)
    await localDB.writings.save({ ...writing, canonical_path: input.binding.canonicalPath, local_updated_at: Date.now() })
    return toCatalogRecord({ ...writing, canonical_path: input.binding.canonicalPath })
  }
  async detachLocalFile(id: string) { await localDB.writings.detachLocalFile(id) }
  async applyCloudSnapshot(snapshot: CloudDocumentSnapshot) {
    const writing = await localDB.writings.get(snapshot.id)
    if (!writing) return
    await localDB.writings.save({
      ...writing,
      author_id: snapshot.cloudAccountId,
      title: snapshot.title,
      slug: snapshot.slug,
      status: snapshot.status ?? writing.status,
      artifact_type: snapshot.artifactType,
      visibility: snapshot.visibility ?? writing.visibility,
      version: snapshot.version ?? writing.version,
      deleted_at: snapshot.deletedAt,
      lifecycle: snapshot.cloudPresent ? "server-confirmed" : writing.lifecycle,
      sync_status: snapshot.syncStatus === "local-only" || snapshot.syncStatus === "conflict"
        ? "synced"
        : snapshot.syncStatus,
      local_updated_at: Date.now(),
    })
  }
  subscribe(listener: (change: CatalogChange) => void) {
    return subscribeToLocalDBChanges(() => listener({
      transactionId: crypto.randomUUID(), documentIds: [], reason: "bulk", occurredAt: Date.now(),
    }))
  }
}

export const webDocumentCatalog = new WebDocumentCatalog()
