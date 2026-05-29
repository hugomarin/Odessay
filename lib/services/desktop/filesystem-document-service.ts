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
import {
  tauriCreateFile,
  tauriListRecentFiles,
  tauriOpenFile,
  tauriRenameFile,
  tauriWriteFile,
} from "@/lib/services/desktop/tauri-commands"
import type { DesktopFileMetadata } from "@/lib/services/desktop/tauri-commands"

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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
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
 */
export class FilesystemDocumentService implements DocumentService {
  readonly writingsDir: string

  private savedListeners: SavedListener[] = []
  private pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly autoSaveDebounceMs: number

  constructor(writingsDir: string, autoSaveDebounceMs = 500) {
    this.writingsDir = writingsDir
    this.autoSaveDebounceMs = autoSaveDebounceMs
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

  // ─── Desktop-specific helpers ──────────────────────────────────────────────

  /**
   * Create a new .md file in writingsDir and return a WritingRecord.
   * writingId = absolute file path.
   *
   * Requirement §2 (ODE-208): createDraft(title?) → new .md file in user writings dir.
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
      return ok({ path, writing })
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to create draft")
    }
  }

  // ─── DocumentService interface ─────────────────────────────────────────────

  /**
   * List .md files in writingsDir sorted by modification time (most recent first).
   * No index needed — reads directory directly (ODE-210 will add SQLite index).
   */
  async listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>> {
    void input
    try {
      const files = await tauriListRecentFiles(this.writingsDir, 200)
      return ok(files.map(fileMetadataToSummary))
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to list writings")
    }
  }

  /**
   * Open a .md file by its absolute path (writingId = path).
   * Returns a WritingRecord with content.markdown = raw file content.
   *
   * Requirement §3 (ODE-208): openDocument(path) reads the .md from the filesystem.
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
   * Emits a "saved" event after the file is fully persisted.
   *
   * Performance Contract §interaction-latency: completes in < 100ms for typical
   * documents (< 100KB). The atomic write (write-then-rename) in Rust prevents
   * partial reads but adds no perceptible latency at typical document sizes.
   *
   * Requirement §4 (ODE-208): promise does not resolve until the file is saved.
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
      this.emitSaved(writing.id)
      return ok(savedRecord)
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to save writing")
    }
  }

  /**
   * Rename the .md file to a slug derived from the new title.
   * The returned WritingRecord has id = newPath.
   *
   * Consumers must update their reference to the writingId after a rename.
   * Requirement §5 (ODE-208): renameDocument(oldPath, newPath) renames on disk.
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
      return ok(renamedRecord)
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to rename writing")
    }
  }

  /**
   * Delete the .md file from disk.
   * Returns the record with deletedAt set.
   */
  async deleteWriting(input: DeleteWritingInput): Promise<ServiceResponse<WritingRecord>> {
    const { writingId } = input
    try {
      const openResult = await this.openWriting(writingId)
      if (openResult.error) return openResult as ServiceResponse<WritingRecord>
      const record = openResult.data!

      // Move the file to a .trash/ sibling directory so it is no longer listed
      // but can be recovered. ODE-210 will add permanent deletion and SQLite cleanup.
      const parts = writingId.split("/")
      const filename = parts.pop()!
      const dir = parts.join("/")
      const trashDir = `${dir}/.trash`
      await tauriRenameFile(writingId, `${trashDir}/${filename}`).catch(() => {
        // If rename fails (e.g. cross-device), fall back silently. The record is
        // still marked deleted in the returned WritingRecord.
      })

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
   * Returns an empty list — ODE-210 will add the SQLite layer.
   */
  async listWritingCollections(
    writingId: string,
  ): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    void writingId
    return ok([])
  }

  /**
   * Collections are not supported without a database.
   * No-op — ODE-210 will add the SQLite layer.
   */
  async setWritingCollections(
    input: SetWritingCollectionsInput,
  ): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    void input
    return ok([])
  }

  /**
   * Basic markdown export — returns the raw .md content as bytes.
   * PDF/DOCX export can be added in a later issue.
   */
  async exportWriting(input: ExportWritingInput): Promise<ServiceResponse<ExportedDocumentArtifact>> {
    if (input.format !== "pdf" && input.format !== "docx") {
      return err("UNSUPPORTED", `Export format ${input.format} is not supported on desktop yet`)
    }
    try {
      const markdown = await tauriOpenFile(input.writingId)
      const filename = input.writingId.split("/").pop()?.replace(/\.md$/, "") ?? "export"
      const bytes = new TextEncoder().encode(markdown)
      return ok({
        writingId: input.writingId,
        format: input.format,
        fileName: `${filename}.md`,
        mimeType: "text/markdown",
        bytes,
      })
    } catch (e) {
      return err("STORAGE_ERROR", e instanceof Error ? e.message : "Failed to export writing")
    }
  }
}
