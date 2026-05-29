import { invoke } from "@tauri-apps/api/core"

export type DesktopFileMetadata = {
  path: string
  name: string
  modifiedAt: number
  size: number
}

export type IndexEntry = {
  path: string
  title: string
  createdAt: number
  modifiedAt: number
}

export async function tauriOpenFile(path: string): Promise<string> {
  return invoke<string>("open_file", { path })
}

export async function tauriCreateFile(dir: string, filename: string): Promise<string> {
  return invoke<string>("create_file", { dir, filename })
}

export async function tauriWriteFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content })
}

export async function tauriRenameFile(oldPath: string, newPath: string): Promise<string> {
  return invoke<string>("rename_file", { oldPath, newPath })
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
