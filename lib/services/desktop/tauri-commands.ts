import { invoke } from "@tauri-apps/api/core"

export type DesktopFileMetadata = {
  path: string
  name: string
  modifiedAt: number
  size: number
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
