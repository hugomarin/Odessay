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
  UpdateWritingMetadataInput,
} from "@/lib/services/contracts/document-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import {
  filenameToTitle,
  resolveUniqueFilename,
  titleToFilename,
  UNTITLED_DOCUMENT_NAME,
} from "@/lib/desktop/document-naming"
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

function extractPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, " ")
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
    artifactType: "general",
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
 * Uses the file path as the storage address.
 * .md files on disk are the source of truth for content — no Supabase, no
 * IndexedDB, no auth required. The filename (stem) is the source of truth for
 * the document name; `title` in caches/cloud reflects it (ODE-324).
 * The configured writingsDir is only the default location for app-created drafts
 * and directory-list fallback, not an ownership boundary.
 *
 * Invariants (Architecture Contract §ODE-208 / ODE-324):
 *  - Implements DocumentService without redefining the contract.
 *  - .md on disk is the source of truth for content; the filename is the source
 *    of truth for the document name.
 *  - May depend on Tauri invoke but not on Next.js, Supabase, cookies, or /api/*.
 *  - Write-path: UI → saveWriting() → tauriWriteFile() → .md on disk.
 *  - Auth and sync failures must never block the local save.
 *  - Markdown serialization/deserialization lives here (TypeScript), not in Rust.
 *
 * The former path-only `writings_index` projection was retired in ODE-374.
 * UUID/binding/presence listing belongs to DocumentCatalog; this low-level
 * adapter only lists the directory when its legacy contract is called directly.
 */
export class FilesystemDocumentService implements DocumentService {
  readonly writingsDir: string

  private savedListeners: SavedListener[] = []
  private pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly autoSaveDebounceMs: number

  constructor(
    writingsDir: string,
    options?: { autoSaveDebounceMs?: number },
  ) {
    this.writingsDir = writingsDir
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

  async updateWritingMetadata(input: UpdateWritingMetadataInput): Promise<ServiceResponse<WritingRecord>> {
    void input
    return err("UNAVAILABLE", "FilesystemDocumentService does not own document metadata")
  }

  async updateWritingsMetadata(input: { updates: UpdateWritingMetadataInput[] }): Promise<ServiceResponse<WritingRecord[]>> {
    void input
    return err("UNAVAILABLE", "FilesystemDocumentService does not own document metadata")
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
   * Create a new .md file in the default draft directory and return a WritingRecord.
   * writingId = absolute file path.
   *
   * The filename is derived from the human title. Collisions are resolved in
   * TypeScript ("Nombre.md" → "Nombre 2.md") before invoking Rust, because
   * `rename_file` can overwrite silently.
   */
  async createDraft(title?: string): Promise<ServiceResponse<CreateDraftResult>> {
    const displayTitle = title ?? UNTITLED_DOCUMENT_NAME
    const initialContent = title ? `# ${title}\n\n` : ""

    try {
      const existing = await this.listDirectoryFilenames(this.writingsDir)
      const desiredFilename = titleToFilename(displayTitle)
      const filename = resolveUniqueFilename(desiredFilename, existing)

      const path = await tauriCreateFile(this.writingsDir, filename)
      const effectiveTitle = filenameToTitle(path)
      if (initialContent) {
        await tauriWriteFile(path, initialContent)
      }
      const now = isoNow()
      const writing: WritingRecord = {
        id: path,
        authorId: null,
        title: effectiveTitle,
        content: {
          markdown: initialContent,
          richText: null,
          plainText: "",
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        artifactType: "general",
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

  private async listDirectoryFilenames(dir: string): Promise<string[]> {
    try {
      const files = await tauriListRecentFiles(dir, 10_000)
      return files.map((meta) => meta.path.split("/").pop() ?? meta.name)
    } catch {
      return []
    }
  }

  // ─── DocumentService interface ─────────────────────────────────────────────

  /**
   * List writings.
   * UUID-aware product listing uses DocumentCatalog; this direct adapter method
   * remains a filesystem-only fallback for tests and low-level callers.
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
   * The document title is the filename stem (ODE-324), not a heading inside the body.
   */
  async openWriting(writingId: string): Promise<ServiceResponse<WritingRecord>> {
    try {
      const markdown = await tauriOpenFile(writingId)
      const filename = writingId.split("/").pop() ?? writingId
      const title = filenameToTitle(filename)
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
        artifactType: "general",
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
   * Rename the .md file to a filename derived from the new human title.
   * Collisions are resolved in TypeScript before invoking Rust.
   */
  async renameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>> {
    const { writingId, title } = input
    if (!title) {
      return err("INVALID_INPUT", "title is required for renameWriting on desktop")
    }
    try {
      const dir = writingId.split("/").slice(0, -1).join("/")
      const currentFilename = writingId.split("/").pop() ?? ""
      const existing = (await this.listDirectoryFilenames(dir)).filter(
        (filename) => filename.toLowerCase() !== currentFilename.toLowerCase(),
      )
      const desiredFilename = titleToFilename(title)
      const newFilename = resolveUniqueFilename(desiredFilename, existing)
      const newPath = `${dir}/${newFilename}`

      if (newPath === writingId) {
        return this.openWriting(writingId)
      }

      const resolvedNewPath = await tauriRenameFile(writingId, newPath)

      const markdown = await tauriOpenFile(resolvedNewPath)
      const now = isoNow()
      const renamedRecord: WritingRecord = {
        id: resolvedNewPath,
        authorId: null,
        title: filenameToTitle(resolvedNewPath),
        content: {
          markdown,
          richText: null,
          plainText: extractPlainText(markdown),
          canonicalSource: "markdown",
        },
        slug: null,
        status: "draft",
        artifactType: "general",
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
      const trashFilename = resolveUniqueFilename(
        filename,
        await this.listDirectoryFilenames(trashDir),
      )
      await tauriRenameFile(writingId, `${trashDir}/${trashFilename}`)

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
      const title = filenameToTitle(filename)

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
