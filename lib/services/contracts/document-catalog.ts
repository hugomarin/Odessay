import type { ArtifactType, WritingVisibility } from "@/lib/services/contracts/document-service"
import type { WritingStatus } from "@/lib/writings/status"

export type CatalogSyncStatus = "local-only" | "pending" | "synced" | "conflict" | "failed" | "deleted"

export type DocumentCatalogReference = {
  value: string
  kind: "path" | "slug"
}

export type DocumentCatalogRecord = {
  id: string
  localPresent: boolean
  cloudPresent: boolean
  cloudAccountId: string | null
  syncStatus: CatalogSyncStatus
  title: string | null
  slug: string | null
  status: WritingStatus | null
  artifactType: ArtifactType | null
  visibility: WritingVisibility | null
  version: number | null
  /** Confirmed user archive marker. Independent from retryable sync status. */
  deletedAt: string | null
  createdAt: number | null
  modifiedAt: number | null
  /** Rebuildable content-derived preview; never a source of document truth. */
  excerpt?: string | null
  /** Rebuildable outbound-reference projection; never document body text. */
  referenceTargets?: DocumentCatalogReference[] | null
  binding: DocumentBindingRecord | null
}

export type DocumentBindingRecord = {
  documentId: string
  bindingRootId: string
  relativePath: string
  canonicalPath: string
  inode: number | null
  contentHash: string | null
  size: number | null
  lastSeenAt: number | null
}

export type DocumentCatalogQuery = {
  cloudAccountId?: string | null
  includeDeleted?: boolean
  localOnly?: boolean
  limit?: number
}

export type PathResolution =
  | { kind: "resolved"; record: DocumentCatalogRecord }
  | { kind: "unbound"; path: string }

export type CatalogChange = {
  transactionId: string
  documentIds: string[]
  reason: "upsert" | "detach" | "cloud-snapshot" | "migration" | "bulk"
  occurredAt: number
}

export type RegisterBindingInput = {
  document: Omit<DocumentCatalogRecord, "binding">
  binding: DocumentBindingRecord
}

export type CloudDocumentSnapshot = Omit<DocumentCatalogRecord, "binding" | "localPresent" | "excerpt" | "referenceTargets"> & {
  localPresent?: boolean
  contentHash?: string | null
}

export interface DocumentCatalog {
  getById(id: string): Promise<DocumentCatalogRecord | null>
  resolvePath(path: string): Promise<PathResolution>
  list(query?: DocumentCatalogQuery): Promise<DocumentCatalogRecord[]>
  /** Optional desktop-only rebuild of content-derived metadata projections. */
  hydrateContentProjections?(): Promise<void>
  registerBinding(input: RegisterBindingInput): Promise<DocumentCatalogRecord>
  detachLocalFile(id: string): Promise<void>
  applyCloudSnapshot(snapshot: CloudDocumentSnapshot): Promise<void>
  subscribe(listener: (change: CatalogChange) => void): () => void
}
