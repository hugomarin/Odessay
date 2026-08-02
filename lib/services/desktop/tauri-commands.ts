import { invoke } from "@tauri-apps/api/core"
import { markOdessaySelfWritePath } from "@/lib/services/desktop/tauri-fs-watch"

export type DesktopFileMetadata = {
  path: string
  name: string
  modifiedAt: number
  size: number
}

export type DesktopWorkspaceFile = {
  id: string
  path: string
  relativePath: string
  name: string
  modifiedAt: number
  size: number
  inode: number
  contentHash: string
}

export type DesktopWorkspaceSnapshot = {
  rootPath: string
  bindingRootId: string
  name: string
  fileCount: number
  folderCount: number
  updatedAt: number | null
  selectedPaths: string[]
  files: DesktopWorkspaceFile[]
}

export type DesktopManifestBindingRepair = {
  documentId: string
  relativePath: string
  inode: number | null
  contentHash: string | null
  lastSeen: number | null
  size: number | null
}

export type DesktopCatalogRow = {
  id: string; localPresent: boolean; cloudPresent: boolean; cloudAccountId: string | null
  syncStatus: string; title: string | null; slug: string | null; status: string | null
  artifactType: string | null; visibility: string | null; version: number | null
  deletedAt: string | null; createdAt: number | null; modifiedAt: number | null; bindingRootId: string | null
  relativePath: string | null; canonicalPath: string | null; inode: number | null
  contentHash: string | null; size: number | null; lastSeenAt: number | null
  excerpt: string | null; excerptContentHash: string | null
}

export type DesktopCatalogDualWriteInput = {
  document: {
    id: string; localPresent: boolean; cloudPresent: boolean; cloudAccountId: string | null
    syncStatus: string; title: string | null; slug: string | null; status: string | null
    artifactType: string | null; visibility: string | null; version: number | null
    deletedAt: string | null; createdAt: number | null; modifiedAt: number | null
  }
  binding: null | {
    bindingRootId: string; rootPath: string; manifestVersion: number; visibleAsWorkspace: boolean
    relativePath: string; canonicalPath: string; inode: number | null; contentHash: string | null
    size: number | null; lastSeenAt: number | null
  }
  mutation: null | {
    id: string; operation: string; payloadJson: string; status: string; attemptCount: number
    nextRetryAt: number | null; createdAt: number; lastError: string | null
  }
}

export type DesktopCloudSnapshotInput = {
  id: string; cloudPresent: boolean; cloudAccountId: string | null; contentHash: string | null
  title: string | null; slug: string | null; status: string | null; artifactType: string | null
  visibility: string | null; version: number | null; deletedAt: string | null
  createdAt: number | null; modifiedAt: number | null
}

export async function tauriOpenFile(path: string): Promise<string> {
  return invoke<string>("open_file", { path })
}

export async function tauriCreateFile(dir: string, filename: string): Promise<string> {
  const path = await invoke<string>("create_file", { dir, filename })
  markOdessaySelfWritePath(path)
  return path
}

export async function tauriWriteFile(path: string, content: string): Promise<void> {
  markOdessaySelfWritePath(path)
  await invoke<void>("write_file", { path, content })
  markOdessaySelfWritePath(path)
}

export async function tauriWriteBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  markOdessaySelfWritePath(path)
  await invoke<void>("write_binary_file", { path, bytes: Array.from(bytes) })
  markOdessaySelfWritePath(path)
}

export async function tauriRenameFile(oldPath: string, newPath: string): Promise<string> {
  markOdessaySelfWritePath(oldPath)
  markOdessaySelfWritePath(newPath)
  const resolvedPath = await invoke<string>("rename_file", { oldPath, newPath })
  markOdessaySelfWritePath(resolvedPath)
  return resolvedPath
}

/**
 * Conscious physical move (ODE-402): collision-suffixing, cross-device-safe
 * rename that never overwrites. Marks every involved path as a self-write so
 * the watcher does not duplicate the reconciliation the caller projects itself.
 * Returns the final destination path (may carry a collision suffix).
 */
export async function tauriRelocateFile(oldPath: string, newPath: string): Promise<string> {
  markOdessaySelfWritePath(oldPath)
  markOdessaySelfWritePath(newPath)
  const resolvedPath = await invoke<string>("relocate_file", { oldPath, newPath })
  markOdessaySelfWritePath(resolvedPath)
  return resolvedPath
}

export async function tauriListRecentFiles(
  dir: string,
  limit = 50,
): Promise<DesktopFileMetadata[]> {
  return invoke<DesktopFileMetadata[]>("list_recent_files", { dir, limit })
}

export async function tauriResolveAssetPath(
  docPath: string,
  relativePath: string,
): Promise<string> {
  return invoke<string>("resolve_asset_path", { docPath, relativePath })
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export async function tauriWorkspaceCreate(parentPath: string, name: string): Promise<string> {
  return invoke<string>("workspace_create", { parentPath, name })
}

export async function tauriWorkspaceInspect(rootPath: string): Promise<DesktopWorkspaceSnapshot> {
  return invoke<DesktopWorkspaceSnapshot>("workspace_inspect", { rootPath })
}

export async function tauriWorkspaceRepairManifestBindings(
  rootPath: string,
  bindingRootId: string,
  bindings: DesktopManifestBindingRepair[],
): Promise<number> {
  return invoke<number>("workspace_repair_manifest_bindings", {
    rootPath,
    bindingRootId,
    bindings,
  })
}

export async function tauriWorkspaceSync(
  rootPath: string,
  selectedPaths?: string[],
  documentIds?: Record<string, string>,
): Promise<DesktopWorkspaceSnapshot> {
  const unboundPaths = await invoke<string[]>("workspace_unbound_paths", { rootPath, selectedPaths })
  const clientIds = { ...documentIds }
  for (const relativePath of unboundPaths) {
    clientIds[relativePath] ??= crypto.randomUUID()
  }
  return invoke<DesktopWorkspaceSnapshot>("workspace_sync", {
    rootPath,
    selectedPaths,
    documentIds: Object.keys(clientIds).length > 0 ? clientIds : undefined,
  })
}

export async function tauriComputeContentHash(markdown: string): Promise<string> {
  return invoke<string>("workspace_compute_content_hash", { markdown })
}

export async function tauriCatalogSchemaVersion(dbPath: string): Promise<number> {
  return invoke<number>("catalog_schema_version", { dbPath })
}

export async function tauriCatalogDualWrite(dbPath: string, input: DesktopCatalogDualWriteInput): Promise<void> {
  return invoke<void>("catalog_dual_write", { dbPath, input })
}

/** Returns the ids written, in input order, so the caller can emit one CatalogChange. */
export async function tauriCatalogBulkDualWrite(dbPath: string, inputs: DesktopCatalogDualWriteInput[]): Promise<string[]> {
  return invoke<string[]>("catalog_bulk_dual_write", { dbPath, inputs })
}

export async function tauriCatalogCountBindingRootDocuments(dbPath: string, bindingRootId: string): Promise<{ total: number; cloud: number }> {
  return invoke<{ total: number; cloud: number }>("catalog_count_binding_root_documents", { dbPath, bindingRootId })
}

export async function tauriCatalogListBindingRootDocuments(dbPath: string, bindingRootId: string): Promise<DesktopCatalogRow[]> {
  return invoke<DesktopCatalogRow[]>("catalog_list_binding_root_documents", { dbPath, bindingRootId })
}

export async function tauriCatalogApplyWorkspaceRemoval(dbPath: string, bindingRootId: string, deletedAt: string, updatedAt: string): Promise<string[]> {
  return invoke<string[]>("catalog_apply_workspace_removal", { dbPath, bindingRootId, deletedAt, updatedAt, nowMillis: Date.now() })
}

/**
 * Re-adding a previously removed folder: restores local-only documents to the
 * active catalog and returns only the cloud-archived ones, which still need the
 * "local wins" upsert. Filtering happens in SQL — never load the whole catalog.
 */
export async function tauriCatalogReactivateBindingRoot(dbPath: string, bindingRootId: string): Promise<DesktopCatalogRow[]> {
  return invoke<DesktopCatalogRow[]>("catalog_reactivate_binding_root", { dbPath, bindingRootId })
}

export async function tauriCatalogApplyCloudSnapshots(
  dbPath: string,
  snapshots: DesktopCloudSnapshotInput[],
): Promise<void> {
  return invoke<void>("catalog_apply_cloud_snapshots", { dbPath, snapshots })
}

export async function tauriCatalogFindEligibleCloudHash(
  dbPath: string,
  contentHash: string,
  cloudAccountId: string,
): Promise<string[]> {
  return invoke<string[]>("catalog_find_eligible_cloud_hash", { dbPath, contentHash, cloudAccountId })
}

export async function tauriCatalogGetById(dbPath: string, id: string): Promise<DesktopCatalogRow | null> {
  return invoke<DesktopCatalogRow | null>("catalog_get_by_id", { dbPath, id })
}

export async function tauriCatalogResolvePath(dbPath: string, path: string): Promise<DesktopCatalogRow | null> {
  return invoke<DesktopCatalogRow | null>("catalog_resolve_path", { dbPath, path })
}

export async function tauriCatalogList(
  dbPath: string,
  query: { cloudAccountId?: string | null; includeDeleted?: boolean; localOnly?: boolean; limit?: number } = {},
): Promise<DesktopCatalogRow[]> {
  return invoke<DesktopCatalogRow[]>("catalog_list", {
    dbPath,
    cloudAccountId: query.cloudAccountId ?? null,
    includeDeleted: query.includeDeleted ?? false,
    localOnly: query.localOnly ?? false,
    limit: query.limit ?? 200,
  })
}

export async function tauriCatalogDetachLocalFile(dbPath: string, id: string): Promise<void> {
  return invoke<void>("catalog_detach_local_file", { dbPath, id })
}

export async function tauriCatalogHydrateExcerpts(dbPath: string): Promise<string[]> {
  return invoke<string[]>("catalog_hydrate_excerpts", { dbPath })
}

export type DesktopCatalogLocalBinding = {
  bindingRootId: string; rootPath: string; manifestVersion: number; visibleAsWorkspace: boolean
  documentId: string; relativePath: string; canonicalPath: string; inode: number | null
  contentHash: string | null; size: number | null; lastSeenAt: number | null
  title: string; createdAt: number | null; modifiedAt: number | null
}

export type DesktopCatalogReconcileInput = {
  upserts: DesktopCatalogLocalBinding[]
  detached: string[]
}

export async function tauriCatalogApplyReconcile(
  dbPath: string,
  input: DesktopCatalogReconcileInput,
): Promise<void> {
  return invoke<void>("catalog_apply_reconcile", { dbPath, input })
}

export async function tauriCatalogUpdateMutationStatus(
  dbPath: string,
  mutationId: string,
  status: "pending" | "synced" | "failed",
  attemptCount: number,
  nextRetryAt: number | null,
  lastError: string | null,
): Promise<void> {
  return invoke<void>("catalog_update_mutation_status", { dbPath, mutationId, status, attemptCount, nextRetryAt, lastError })
}

export async function tauriCatalogPurgeDocument(dbPath: string, id: string): Promise<void> {
  return invoke<void>("catalog_purge_document", { dbPath, id })
}

export type DesktopCatalogMutationRow = {
  id: string
  documentId: string
  operation: "upsert" | "delete"
  payloadJson: string
  status: "pending" | "failed"
  attemptCount: number
  nextRetryAt: number | null
  createdAt: number
  lastError: string | null
}

export async function tauriCatalogEnqueueMutation(
  dbPath: string,
  documentId: string,
  mutation: NonNullable<DesktopCatalogDualWriteInput["mutation"]>,
): Promise<void> {
  return invoke<void>("catalog_enqueue_mutation", { dbPath, documentId, mutation })
}

export async function tauriCatalogListPendingMutations(
  dbPath: string,
  now = Date.now(),
  limit = 200,
): Promise<DesktopCatalogMutationRow[]> {
  return invoke<DesktopCatalogMutationRow[]>("catalog_list_pending_mutations", { dbPath, now, limit })
}

export type DesktopCatalogCollection = {
  id: string; ownerId: string | null; name: string; description: string | null
  visibility: "private" | "public"; syncStatus: string; lifecycle: string
  deletedAt: string | null; createdAt: string; updatedAt: string; localUpdatedAt: number
}

export type DesktopCatalogWritingCollection = {
  writingId: string; collectionId: string; addedAt: string; localUpdatedAt: number
}

export type DesktopCatalogCollectionSnapshot = {
  collections: DesktopCatalogCollection[]
  writingCollections: DesktopCatalogWritingCollection[]
}

export type DesktopCatalogMetadataMutation = {
  id: string; entityKind: "collection" | "writing-collections"; entityId: string
  operation: "upsert" | "delete" | "set"; payloadJson: string
  status: "pending" | "failed" | "synced"; attemptCount: number
  nextRetryAt: number | null; createdAt: number; lastError: string | null
}

export function tauriCatalogApplyCollectionSnapshot(dbPath: string, snapshot: DesktopCatalogCollectionSnapshot) {
  return invoke<void>("catalog_apply_collection_snapshot", { dbPath, snapshot })
}

export function tauriCatalogListCollectionSnapshot(dbPath: string) {
  return invoke<DesktopCatalogCollectionSnapshot>("catalog_list_collection_snapshot", { dbPath })
}

export function tauriCatalogSaveCollection(
  dbPath: string,
  collection: DesktopCatalogCollection,
  mutation: DesktopCatalogMetadataMutation | null,
) {
  return invoke<void>("catalog_save_collection", { dbPath, collection, mutation })
}

export function tauriCatalogDeleteCollection(
  dbPath: string,
  collectionId: string,
  deletedAt: string,
  localUpdatedAt: number,
  mutation: DesktopCatalogMetadataMutation,
) {
  return invoke<void>("catalog_delete_collection", { dbPath, collectionId, deletedAt, localUpdatedAt, mutation })
}

export function tauriCatalogReplaceWritingCollections(
  dbPath: string,
  writingId: string,
  collectionIds: string[],
  addedAt: string,
  localUpdatedAt: number,
  mutation: DesktopCatalogMetadataMutation | null,
) {
  return invoke<void>("catalog_replace_writing_collections", {
    dbPath, writingId, collectionIds, addedAt, localUpdatedAt, mutation,
  })
}

export function tauriCatalogListPendingMetadataMutations(dbPath: string, now = Date.now(), limit = 200) {
  return invoke<DesktopCatalogMetadataMutation[]>("catalog_list_pending_metadata_mutations", { dbPath, now, limit })
}

export function tauriCatalogUpdateMetadataMutationStatus(
  dbPath: string,
  mutationId: string,
  status: "pending" | "synced" | "failed",
  attemptCount: number,
  nextRetryAt: number | null,
  lastError: string | null,
) {
  return invoke<void>("catalog_update_metadata_mutation_status", {
    dbPath, mutationId, status, attemptCount, nextRetryAt, lastError,
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function tauriSettingsRead(configDir: string, key: string): Promise<unknown> {
  const json = await invoke<string>("settings_read", { configDir, key })
  return JSON.parse(json)
}

export async function tauriSettingsWrite(
  configDir: string,
  key: string,
  value: unknown,
): Promise<void> {
  return invoke<void>("settings_write", { configDir, key, valueJson: JSON.stringify(value) })
}

export async function tauriSettingsDelete(configDir: string, key: string): Promise<void> {
  return invoke<void>("settings_delete", { configDir, key })
}

export async function tauriSettingsListKeys(configDir: string): Promise<string[]> {
  return invoke<string[]>("settings_list_keys", { configDir })
}

// ─── Keychain ─────────────────────────────────────────────────────────────────

export async function tauriKeychainWrite(account: string, value: string): Promise<void> {
  return invoke<void>("keychain_write_token", { account, value })
}

export async function tauriKeychainRead(account: string): Promise<string | null> {
  return invoke<string | null>("keychain_read_token", { account })
}

export async function tauriKeychainDelete(account: string): Promise<void> {
  return invoke<void>("keychain_delete_token", { account })
}
