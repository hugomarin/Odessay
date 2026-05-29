import {
  tauriIndexDelete,
  tauriIndexList,
  tauriIndexRebuild,
  tauriIndexUpsert,
  type IndexEntry,
} from "@/lib/services/desktop/tauri-commands"

export type IndexUpdateListener = (path: string) => void
export type IndexRebuildListener = (count: number) => void

/**
 * Desktop local SQLite index for writings.
 *
 * Architecture Contract §ODE-210:
 *  - The index is derived and always rebuildable from .md files.
 *  - If the SQLite file is missing or corrupt, the app starts without it
 *    and can rebuild on demand or in background.
 *  - The .md file wins in any conflict.
 *  - Exactly one index-update event is emitted per save operation.
 */
export class LocalIndexService {
  readonly dbPath: string
  readonly writingsDir: string

  private updateListeners: IndexUpdateListener[] = []
  private rebuildListeners: IndexRebuildListener[] = []

  constructor(dbPath: string, writingsDir: string) {
    this.dbPath = dbPath
    this.writingsDir = writingsDir
  }

  // ─── Event subscription ────────────────────────────────────────────────────

  onIndexUpdated(listener: IndexUpdateListener): () => void {
    this.updateListeners.push(listener)
    return () => {
      this.updateListeners = this.updateListeners.filter((l) => l !== listener)
    }
  }

  private emitIndexUpdated(path: string): void {
    for (const listener of this.updateListeners) {
      listener(path)
    }
  }

  onRebuildComplete(listener: IndexRebuildListener): () => void {
    this.rebuildListeners.push(listener)
    return () => {
      this.rebuildListeners = this.rebuildListeners.filter((l) => l !== listener)
    }
  }

  private emitRebuildComplete(count: number): void {
    for (const listener of this.rebuildListeners) {
      listener(count)
    }
  }

  // ─── Core operations ───────────────────────────────────────────────────────

  /**
   * Upsert a writing into the index.
   * Emits exactly one `indexUpdated` event.
   */
  async upsert(
    path: string,
    title: string,
    createdAt: number,
    modifiedAt: number,
  ): Promise<void> {
    await tauriIndexUpsert(this.dbPath, path, title, createdAt, modifiedAt)
    this.emitIndexUpdated(path)
  }

  /**
   * List recent writings from the index, ordered by modification time descending.
   * Falls back to an empty array if the index is missing or unreadable.
   */
  async listRecent(limit = 200): Promise<IndexEntry[]> {
    try {
      return await tauriIndexList(this.dbPath, limit)
    } catch {
      return []
    }
  }

  /**
   * Delete a writing entry from the index.
   */
  async delete(path: string): Promise<void> {
    await tauriIndexDelete(this.dbPath, path)
    this.emitIndexUpdated(path)
  }

  /**
   * Rebuild the index by scanning all .md files in `dir`.
   * If `dir` is omitted, uses the configured writingsDir.
   * This runs without blocking the write-path.
   */
  async rebuildFromDirectory(dir?: string): Promise<number> {
    const targetDir = dir ?? this.writingsDir
    const count = await tauriIndexRebuild(this.dbPath, targetDir)
    this.emitRebuildComplete(count)
    return count
  }
}
