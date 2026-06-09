import type {
  DocumentService,
  DeleteWritingInput,
  ExportedDocumentArtifact,
  ExportWritingInput,
  ListWritingsInput,
  RenameWritingInput,
  SaveWritingInput,
  SetWritingCollectionsInput,
  WritingCollectionMembership,
  WritingRecord,
  WritingSummary,
} from "@/lib/services/contracts/document-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { parseDocumentFileToSnapshot } from "@/lib/editor/document-serialization"
import { renderWritingToDocxBytes } from "@/lib/export/to-docx"
import { renderWritingToPdfBytes } from "@/lib/export/to-pdf"
import { buildWritingExportDocument } from "@/lib/export/writing-export"
import {
  tauriCreateFile,
  tauriListRecentFiles,
  tauriOpenFile,
  tauriRenameFile,
  tauriWriteFile,
} from "@/lib/services/desktop/tauri-commands"
import type { DesktopFileMetadata } from "@/lib/services/desktop/tauri-commands"
import type { LocalIndexService } from "@/lib/services/desktop/local-index-service"

// ─── helpers ─────────────────────────────────────────────────────────────────

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}

function isoNow(): string {
  return new Date().toISOString()
}

function isoToMs(iso: string): number {
  return new Date(iso).getTime()
}

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled"
}

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : fallback
}

function extractPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, " ")
    .trim()
}

function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.md$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
}

function fileMetadataToSummary(meta: DesktopFileMetadata): WritingSummary {
  const title = filenameToTitle(meta.name)
  const updatedAt = new Date(meta.modifiedAt).toISOString()
  return {
    id: meta.path,
    authorId: null,
    title,
    slug: null,
    status: "draft",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version: 1,
    deletedAt: null,
    createdAt: updatedAt,
    updatedAt,
    excerpt: null,
  }
}

function indexEntryToSummary(entry: {
  path: string
  title: string
  createdAt: number
  modifiedAt: number
}): WritingSummary {
  return {
    id: entry.path,
    authorId: null,
    title: entry.title,
    slug: null,
    status: "draft",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version: 1,
    deletedAt: null,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.modifiedAt).toISOString(),
    excerpt: null,
  }
}

// ─── Desktop-specific types ───────────────────────────────────────────────────

export type SavedListener = (writingId: string) => void
export type CreateDraftResult = {
  path: string
  writing: WritingRecord
}

// ─── FilesystemDocumentService ────────────────────────────────────────────────

/**
 * Desktop adapter for DocumentService.
 *
 * Uses the file path as the stable writingId.
 * .md files in writingsDir are the source of truth — no Supabase, no IndexedDB,
 * no auth required.
 *
 * Invariants (Architecture Contract §ODE-208):
 *  - Implements DocumentService without redefining the contract.
 *  - .md on disk is the source of truth; no cache can be more authoritative.
 *  - May depend on Tauri invoke but not on Next.js, Supabase, cookies, or /api/*.
 *  - Write-path: UI → saveWriting() → tauriWriteFile() → .md on disk.
 *  - Auth and sync failures must never block the local save.
 *  - Markdown serialization/deserialization lives here (TypeScript), not in Rust.
 *
 * ODE-210 additions:
 *  - Optional LocalIndexService for derived recent-list acceleration.
 *  - Index is updated on save, rename, create, and delete.
 *  - If index is absent or unreadable, falls back to directory listing.
 */
export class FilesystemDocumentService implements DocumentService {
  readonly writingsDir: string
  readonly localIndex?: LocalIndexService

  private savedListeners: SavedListener[] = []
  private pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly autoSaveDebounceMs: number

  constructor(
    writingsDir: string,
    options?: { localIndex?: LocalIndexService; autoSaveDebounceMs?: number },
  ) {
    this.writingsDir = writingsDir
    this.localIndex = options?.localIndex
    this.autoSaveDebounceMs = options?.autoSaveDebounceMs ?? 500
  }

  // ─── Event subscription ────────────────────────────────────────────────────

  /** Subscribe to "saved" events. Returns an unsubscribe function. */
  onSaved(listener: SavedListener): () => void {
    this.savedListeners.push(listener)
    return () => {
      this.savedListeners = this.savedListeners.filter((l) => l !== listener)
    }
  }

  private emitSaved(writingId: string): void {
    for (const listener of this.savedListeners) {
      listener(writingId)
    }
  }

  // ─── Auto-save (debounced) ─────────────────────────────────────────────────

  /**
   * Schedule a debounced auto-save. Multiple calls within the debounce window
   * collapse into a single disk write, emitting exactly one "saved" event.
   *
   * Performance Contract §reactive-fan-out: the debounce guarantees at most one
   * write and one "saved" emission per debounce window regardless of how many
   * TipTap onUpdate events arrive.
   */
  scheduleAutoSave(writing: WritingRecord): void {
    const existing = this.pendingSaves.get(writing.id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingSaves.delete(writing.id)
      this.saveWriting({ writing }).catch((e) =>
        console.error("[FilesystemDocumentService] auto-save error", e),
      )
    }, this.autoSaveDebounceMs)
    this.pendingSaves.set(writing.id, timer)
  }

  // ─── Index helpers ─────────────────────────────────────────────────────────

  private async upsertIndex(writing: WritingRecord): Promise<void> {
    if (!this.localIndex) return
    const title = writing.title ?? filenameToTitle(writing.id.split("/").pop() ?? "untitled")
    await this.localIndex.upsert(
      writing.id,
      title,
      isoToMs(writing.createdAt),
      Date.now(),
    )
  }

  private async deleteIndex(path: string): Promise<void> {
    if (!this.localIndex) return
    await this.localIndex.delete(path)
  }

  // ─── Desktop-specific helpers ──────────────────────────────────────────────

  /**
   * Create a new .md file in writingsDir and return a WritingRecord.
   * writingId = absolute file path.
   */
  async createDraft(title?: string): Promise<ServiceResponse<CreateDraftResult>> {
    const displayTitle = title ?? "Untitled"
    const slug = slugify(displayTitle)
    const timestamp = Date.now()
    const filename = `${slug}-${timestamp}.md`
    const initialContent = title ? `# ${title}\n\n` : ""

    try {
      const path = await tauriCreateFile(this.writingsDir, filename)
      if (initialContent) {
        await tauriWriteFile(path, initialContent)
      }
      const now = isoNow()
      const writing: WritingRecord = {
        id: path,
        authorId: null,
        title: displayTitle,
        content: {
          markdown: initialContent,
          richText: null,
          plainText: "",
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await this.upsertIndex(writing)
      return ok({ path, writing })
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to create draft")
    }
  }

  // ─── DocumentService interface ─────────────────────────────────────────────

  /**
   * List writings.
   * If a LocalIndexService is configured, reads from the SQLite index.
   * Otherwise falls back to directory listing.
   */
  async listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>> {
    void input
    try {
      if (this.localIndex) {
        const entries = await this.localIndex.listRecent(200)
        if (entries.length > 0) {
          return ok(entries.map(indexEntryToSummary))
        }
      }
      const files = await tauriListRecentFiles(this.writingsDir, 200)
      return ok(files.map(fileMetadataToSummary))
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to list writings")
    }
  }

  /**
   * Open a .md file by its absolute path (writingId = path).
   */
  async openWriting(writingId: string): Promise<ServiceResponse<WritingRecord>> {
    try {
      const markdown = await tauriOpenFile(writingId)
      const filename = writingId.split("/").pop() ?? writingId
      const title = extractTitle(markdown, filenameToTitle(filename))
      const plainText = extractPlainText(markdown)
      const now = isoNow()
      const writing: WritingRecord = {
        id: writingId,
        authorId: null,
        title,
        content: {
          markdown,
          richText: null,
          plainText,
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      return ok(writing)
    } catch (e) {
      return err("NOT_FOUND", e instanceof Error ? e.message : "File not found")
    }
  }

  /**
   * Serialize writing.content.markdown and write it to disk.
   * Updates the SQLite index if configured.
   * Emits a "saved" event after the file is fully persisted.
   */
  async saveWriting(input: SaveWritingInput): Promise<ServiceResponse<WritingRecord>> {
    const { writing } = input
    const markdown = writing.content.markdown ?? ""
    try {
      await tauriWriteFile(writing.id, markdown)
      const savedRecord: WritingRecord = {
        ...writing,
        updatedAt: isoNow(),
        version: writing.version + 1,
      }
      await this.upsertIndex(savedRecord)
      this.emitSaved(writing.id)
      return ok(savedRecord)
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to save writing")
    }
  }

  /**
   * Rename the .md file to a slug derived from the new title.
   */
  async renameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>> {
    const { writingId, title } = input
    if (!title) {
      return err("INVALID_INPUT", "title is required for renameWriting on desktop")
    }
    try {
      const dir = writingId.split("/").slice(0, -1).join("/")
      const timestamp = Date.now()
      const newFilename = `${slugify(title)}-${timestamp}.md`
      const newPath = `${dir}/${newFilename}`
      const resolvedNewPath = await tauriRenameFile(writingId, newPath)

      const markdown = await tauriOpenFile(resolvedNewPath)
      const now = isoNow()
      const renamedRecord: WritingRecord = {
        id: resolvedNewPath,
        authorId: null,
        title,
        content: {
          markdown,
          richText: null,
          plainText: extractPlainText(markdown),
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      await this.deleteIndex(writingId)
      await this.upsertIndex(renamedRecord)

      return ok(renamedRecord)
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to rename writing")
    }
  }

  /**
   * Delete the .md file from disk.
   * Removes from the SQLite index if configured.
   */
  async deleteWriting(input: DeleteWritingInput): Promise<ServiceResponse<WritingRecord>> {
    const { writingId } = input
    try {
      const openResult = await this.openWriting(writingId)
      if (openResult.error) return openResult as ServiceResponse<WritingRecord>
      const record = openResult.data!

      const parts = writingId.split("/")
      const filename = parts.pop()!
      const dir = parts.join("/")
      const trashDir = `${dir}/.trash`
      await tauriRenameFile(writingId, `${trashDir}/${filename}`).catch(() => {
        // If rename fails, fall back silently.
      })

      await this.deleteIndex(writingId)

      const deletedRecord: WritingRecord = {
        ...record,
        deletedAt: input.deletedAt,
        updatedAt: isoNow(),
      }
      return ok(deletedRecord)
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to delete writing")
    }
  }

  /**
   * Collections are not supported without a database.
   */
  async listWritingCollections(
    writingId: string,
  ): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    void writingId
    return ok([])
  }

  /**
   * Collections are not supported without a database.
   */
  async setWritingCollections(
    input: SetWritingCollectionsInput,
  ): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    void input
    return ok([])
  }

  async exportWriting(input: ExportWritingInput): Promise<ServiceResponse<ExportedDocumentArtifact>> {
    if (input.format !== "pdf" && input.format !== "docx") {
      return err("UNSUPPORTED", `Export format ${input.format} is not supported on desktop yet`)
    }
    try {
      const markdown = await tauriOpenFile(input.writingId)
      const parsed = parseDocumentFileToSnapshot(markdown)
      const document = buildWritingExportDocument(parsed.snapshot.bodyJson)
      const filename = input.writingId.split("/").pop()?.replace(/\.md$/, "") ?? "export"
      const title = extractTitle(parsed.markdown, filename)

      const bytes =
        input.format === "pdf"
          ? await renderWritingToPdfBytes({
              title,
              bodyText: parsed.snapshot.bodyText,
              document,
            })
          : await renderWritingToDocxBytes({
              title,
              bodyText: parsed.snapshot.bodyText,
              document,
            })

      return ok({
        writingId: input.writingId,
        format: input.format,
        fileName: `${filename}.${input.format}`,
        mimeType:
          input.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument" + ".wordprocessingml.document",
        bytes,
      })
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to export writing")
    }
  }
}
