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
  name: string
  fileCount: number
  folderCount: number
  updatedAt: number | null
  selectedPaths: string[]
  files: DesktopWorkspaceFile[]
}

export type IndexEntry = {
  path: string
  title: string
  createdAt: number
  modifiedAt: number
}

export type DesktopCatalogRow = {
  id: string; localPresent: boolean; cloudPresent: boolean; cloudAccountId: string | null
  syncStatus: string; title: string | null; slug: string | null; status: string | null
  artifactType: string | null; visibility: string | null; version: number | null
  createdAt: number | null; modifiedAt: number | null; bindingRootId: string | null
  relativePath: string | null; canonicalPath: string | null; inode: number | null
  contentHash: string | null; size: number | null; lastSeenAt: number | null
}

export type DesktopCatalogDualWriteInput = {
  document: {
    id: string; localPresent: boolean; cloudPresent: boolean; cloudAccountId: string | null
    syncStatus: string; title: string | null; slug: string | null; status: string | null
    artifactType: string | null; visibility: string | null; version: number | null
    createdAt: number | null; modifiedAt: number | null
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

export async function tauriWorkspaceSync(
  rootPath: string,
  selectedPaths?: string[],
): Promise<DesktopWorkspaceSnapshot> {
  return invoke<DesktopWorkspaceSnapshot>("workspace_sync", { rootPath, selectedPaths })
}

export async function tauriComputeContentHash(markdown: string): Promise<string> {
  return invoke<string>("workspace_compute_content_hash", { markdown })
}

// ─── Local Index ──────────────────────────────────────────────────────────────

export async function tauriIndexUpsert(
  dbPath: string,
  path: string,
  title: string,
  createdAt: number,
  modifiedAt: number,
): Promise<void> {
  return invoke<void>("index_upsert", { dbPath, path, title, createdAt, modifiedAt })
}

export async function tauriIndexList(dbPath: string, limit = 200): Promise<IndexEntry[]> {
  return invoke<IndexEntry[]>("index_list", { dbPath, limit })
}

export async function tauriIndexDelete(dbPath: string, path: string): Promise<void> {
  return invoke<void>("index_delete", { dbPath, path })
}

export async function tauriIndexRebuild(dbPath: string, dir: string): Promise<number> {
  return invoke<number>("index_rebuild", { dbPath, dir })
}

export async function tauriCatalogSchemaVersion(dbPath: string): Promise<number> {
  return invoke<number>("catalog_schema_version", { dbPath })
}

export async function tauriCatalogDualWrite(dbPath: string, input: DesktopCatalogDualWriteInput): Promise<void> {
  return invoke<void>("catalog_dual_write", { dbPath, input })
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
