import type {
  DeleteWritingInput,
  DocumentService,
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
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { enqueueWritingDelete, enqueueWritingUpsert } from "@/lib/sync/queue"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { webDocumentService } from "@/lib/services/web-document-service"
import { FilesystemDocumentService } from "@/lib/services/desktop/filesystem-document-service"
import { LocalIndexService } from "@/lib/services/desktop/local-index-service"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { migrateIndexedDbToFilesystem } from "@/lib/migrations/indexeddb-to-filesystem"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"

type DesktopRuntimeServices = {
  configDir: string
  writingsDir: string
  filesystem: FilesystemDocumentService
}

type DesktopDraftOptions = {
  writingId?: string | null
  title?: string | null
  slug?: string | null
  status?: WritingRecord["status"]
  visibility?: WritingRecord["visibility"]
  preferredPath?: string | null
  initialBodyJson?: Record<string, unknown> | null
  initialBodyText?: string
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}

function makeUnexpectedError(error: unknown, fallback: ServiceError["code"] = "UNAVAILABLE"): ServiceError {
  return {
    code: fallback,
    message: error instanceof Error ? error.message : "Unexpected error",
    retryable: fallback === "DB_ERROR" || fallback === "UNAVAILABLE",
  }
}

function createWritingId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `desktop-${Date.now()}`
}

function deriveDraftTitleFromPlainText(plainText: string, fallback: string) {
  const firstLine = plainText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine?.slice(0, 48) || fallback
}

function toCanonicalRecord(local: LocalWriting): WritingRecord {
  return {
    id: local.id,
    authorId: local.author_id ?? null,
    title: local.title ?? null,
    content: {
      richText: local.body_json,
      markdown: null,
      plainText: local.body_text,
      canonicalSource: local.canonical_path ? "markdown" : "rich-text",
    },
    slug: local.slug ?? null,
    status: local.status,
    visibility: local.visibility,
    parentId: local.parent_id ?? null,
    correspondenceId: local.correspondence_id ?? null,
    version: local.version,
    deletedAt: local.deleted_at ?? null,
    createdAt: local.created_at,
    updatedAt: local.updated_at,
  }
}

function toLocalWriting(record: WritingRecord, canonicalPath: string): LocalWriting {
  return {
    id: record.id,
    author_id: record.authorId,
    title: record.title,
    canonical_path: canonicalPath,
    body_json: (record.content.richText as Record<string, unknown>) ?? EMPTY_EDITOR_JSON,
    body_text: record.content.plainText,
    slug: record.slug,
    status: record.status,
    visibility: record.visibility,
    parent_id: record.parentId,
    correspondence_id: record.correspondenceId,
    version: Math.max(1, record.version),
    sync_status: "pending",
    lifecycle: "local-only",
    deleted_at: record.deletedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    local_updated_at: Date.now(),
  }
}

async function resolveDesktopRuntimeServices(): Promise<DesktopRuntimeServices> {
  const { appConfigDir, documentDir, join } = await import("@tauri-apps/api/path")

  const configDir = await appConfigDir()
  const defaultWritingsDir = await join(await documentDir(), "Odessay")
  const settingsService = new DesktopSettingsService(configDir)
  const settingsResult = await settingsService.getDesktopSettings()
  const configuredWritingsDir = settingsResult.data?.writingsDir?.trim()
  const writingsDir = configuredWritingsDir && configuredWritingsDir.length > 0
    ? configuredWritingsDir
    : defaultWritingsDir

  if (writingsDir !== configuredWritingsDir) {
    await settingsService.updateDesktopSettings({ writingsDir })
  }

  const indexPath = await join(configDir, "desktop-index.sqlite3")
  const localIndex = new LocalIndexService(indexPath, writingsDir)
  const filesystem = new FilesystemDocumentService(writingsDir, { localIndex })

  return { configDir, writingsDir, filesystem }
}

class DesktopDocumentService implements DocumentService {
  private migrationPromise: Promise<void> | null = null

  constructor(private readonly runtime: DesktopRuntimeServices) {}

  private async ensureMigrated() {
    if (!this.migrationPromise) {
      this.migrationPromise = migrateIndexedDbToFilesystem({
        filesystem: this.runtime.filesystem,
      })
        .then(() => undefined)
        .catch((error) => {
          this.migrationPromise = null
          throw error
        })
    }

    await this.migrationPromise
  }

  private async resolveCanonicalPath(record: WritingRecord) {
    const existing = await localDB.writings.get(record.id)
    if (existing?.canonical_path) {
      return existing.canonical_path
    }

    const draftResult = await this.runtime.filesystem.createDraft(record.title ?? undefined)
    if (draftResult.error || !draftResult.data) {
      throw new Error(draftResult.error?.message ?? "Failed to allocate canonical file")
    }

    return draftResult.data.path
  }

  private buildCanonicalMarkdown(record: WritingRecord) {
    const bodyJson = (record.content.richText as Record<string, unknown> | null | undefined) ?? EMPTY_EDITOR_JSON
    const serialization = desktopDocumentEngine.serializeSourceDocument(bodyJson, {
      id: record.id,
      slug: record.slug,
      status: record.status,
      visibility: record.visibility,
      version: Math.max(1, record.version),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })

    if (!serialization.success) {
      throw new Error(serialization.error)
    }

    return serialization.markdown
  }

  private async writeCanonicalFile(record: WritingRecord, canonicalPath: string) {
    const canonicalMarkdown = this.buildCanonicalMarkdown(record)
    const fileSaveResult = await this.runtime.filesystem.saveWriting({
      writing: {
        ...record,
        id: canonicalPath,
        content: {
          markdown: canonicalMarkdown,
          richText: null,
          plainText: record.content.plainText,
          canonicalSource: "markdown",
        },
        version: Math.max(0, record.version - 1),
      },
    })

    if (fileSaveResult.error) {
      throw new Error(fileSaveResult.error.message)
    }

    const parsed = desktopDocumentEngine.parseSourceDocument(canonicalMarkdown)
    if (!parsed.success) {
      throw new Error(parsed.error)
    }

    return {
      canonicalMarkdown,
      bodyJson: parsed.document.snapshot.bodyJson as Record<string, unknown>,
      bodyText: parsed.document.snapshot.bodyText,
    }
  }

  async listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>> {
    try {
      await this.ensureMigrated()
      const writings = await localDB.writings.getAll({ includeDeleted: input?.includeDeleted })
      const summaries: WritingSummary[] = writings.map((writing) => ({
        ...toCanonicalRecord(writing),
        excerpt: writing.body_text.slice(0, 200) || null,
      }))

      return ok(summaries)
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }

  async openWriting(writingId: string): Promise<ServiceResponse<WritingRecord>> {
    try {
      await this.ensureMigrated()
      const existing = await localDB.writings.get(writingId)
      const canonicalPath =
        existing?.canonical_path ??
        (await localDB.writings.getByCanonicalPath(writingId))?.canonical_path ??
        writingId
      const fileResult = await this.runtime.filesystem.openWriting(canonicalPath)

      if (fileResult.error || !fileResult.data) {
        return err("NOT_FOUND", fileResult.error?.message ?? `Writing ${writingId} not found`)
      }

      const parsed = desktopDocumentEngine.parseSourceDocument(fileResult.data.content.markdown ?? "")
      if (!parsed.success) {
        return err("INVALID_INPUT", parsed.error)
      }

      const metadata = parsed.document.metadata
      const canonicalId = existing?.id ?? metadata?.id ?? writingId
      const localWriting: LocalWriting = {
        id: canonicalId,
        author_id: existing?.author_id ?? null,
        title: existing?.title ?? fileResult.data.title,
        canonical_path: canonicalPath,
        body_json: parsed.document.snapshot.bodyJson as Record<string, unknown>,
        body_text: parsed.document.snapshot.bodyText,
        slug: metadata?.slug ?? existing?.slug ?? null,
        status: metadata?.status ?? existing?.status ?? "draft",
        visibility: metadata?.visibility ?? existing?.visibility ?? "private",
        parent_id: existing?.parent_id ?? null,
        correspondence_id: existing?.correspondence_id ?? null,
        version: metadata?.version ?? existing?.version ?? 1,
        sync_status: existing?.sync_status ?? "synced",
        lifecycle: existing?.lifecycle ?? "local-only",
        deleted_at: existing?.deleted_at ?? null,
        created_at: metadata?.createdAt ?? existing?.created_at ?? fileResult.data.createdAt,
        updated_at: metadata?.updatedAt ?? existing?.updated_at ?? fileResult.data.updatedAt,
        local_updated_at: Date.now(),
      }

      await localDB.writings.save(localWriting)
      return ok(toCanonicalRecord(localWriting))
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }

  async saveWriting(input: SaveWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      await this.ensureMigrated()
      const existing = await localDB.writings.get(input.writing.id)
      const canonicalPath = await this.resolveCanonicalPath(input.writing)
      const derived = await this.writeCanonicalFile(input.writing, canonicalPath)
      const localWriting: LocalWriting = {
        ...toLocalWriting(input.writing, canonicalPath),
        author_id: existing?.author_id ?? input.writing.authorId ?? null,
        body_json: derived.bodyJson,
        body_text: derived.bodyText,
        slug: input.writing.slug ?? existing?.slug ?? null,
        lifecycle: existing?.lifecycle ?? "local-only",
      }

      await enqueueWritingUpsert(localWriting)
      return ok(toCanonicalRecord(localWriting))
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }

  async createDraft(options: DesktopDraftOptions = {}): Promise<ServiceResponse<WritingRecord>> {
    try {
      await this.ensureMigrated()
      const nowIso = new Date().toISOString()
      const writing: WritingRecord = {
        id: options.writingId?.trim() || createWritingId(),
        authorId: null,
        title: options.title?.trim() || "Untitled writing",
        content: {
          richText: (options.initialBodyJson as Record<string, unknown> | null | undefined) ?? EMPTY_EDITOR_JSON,
          markdown: null,
          plainText: options.initialBodyText ?? "",
          canonicalSource: "rich-text",
        },
        slug: options.slug ?? null,
        status: options.status ?? "draft",
        visibility: options.visibility ?? "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }

      const canonicalPath =
        options.preferredPath?.trim() ||
        (await this.runtime.filesystem.createDraft(writing.title ?? undefined)).data?.path

      if (!canonicalPath) {
        return err("UNAVAILABLE", "Failed to allocate canonical file")
      }

      const derived = await this.writeCanonicalFile(writing, canonicalPath)
      const localWriting: LocalWriting = {
        ...toLocalWriting(writing, canonicalPath),
        body_json: derived.bodyJson,
        body_text: derived.bodyText,
      }

      await enqueueWritingUpsert(localWriting)
      return ok(toCanonicalRecord(localWriting))
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }

  async renameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      await this.ensureMigrated()
      const existing = await localDB.writings.get(input.writingId)
      if (!existing?.canonical_path) {
        return err("NOT_FOUND", `Writing ${input.writingId} not found`)
      }

      const renameResult = await this.runtime.filesystem.renameWriting({
        writingId: existing.canonical_path,
        title: input.title,
        updatedAt: input.updatedAt,
      })

      if (renameResult.error || !renameResult.data) {
        return err("UNAVAILABLE", renameResult.error?.message ?? "Failed to rename writing")
      }

      const updated: LocalWriting = {
        ...existing,
        title: input.title,
        canonical_path: renameResult.data.id,
        updated_at: input.updatedAt,
        local_updated_at: Date.now(),
      }

      await enqueueWritingUpsert(updated)
      return ok(toCanonicalRecord(updated))
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }

  async deleteWriting(input: DeleteWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      await this.ensureMigrated()
      const existing = await localDB.writings.get(input.writingId)
      if (!existing?.canonical_path) {
        return err("NOT_FOUND", `Writing ${input.writingId} not found`)
      }

      const fileDeleteResult = await this.runtime.filesystem.deleteWriting({
        writingId: existing.canonical_path,
        version: input.version,
        updatedAt: input.updatedAt,
        deletedAt: input.deletedAt,
      })

      if (fileDeleteResult.error) {
        return err("UNAVAILABLE", fileDeleteResult.error.message)
      }

      await enqueueWritingDelete(existing.id)
      const deleted = await localDB.writings.get(existing.id)

      if (!deleted) {
        return err("NOT_FOUND", `Writing ${existing.id} not found after delete`)
      }

      return ok(toCanonicalRecord(deleted))
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }

  async listWritingCollections(
    writingId: string,
  ): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    return webDocumentService.listWritingCollections(writingId)
  }

  async setWritingCollections(
    input: SetWritingCollectionsInput,
  ): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    return webDocumentService.setWritingCollections(input)
  }

  async exportWriting(input: ExportWritingInput): Promise<ServiceResponse<{
    writingId: string
    format: "pdf" | "docx"
    fileName: string
    mimeType: string
    bytes: Uint8Array
  }>> {
    try {
      await this.ensureMigrated()

      const localWriting = await localDB.writings.get(input.writingId)
      if (!localWriting?.canonical_path) {
        return err("NOT_FOUND", `Writing ${input.writingId} not found`)
      }

      return this.runtime.filesystem.exportWriting({
        writingId: localWriting.canonical_path,
        format: input.format,
      })
    } catch (error) {
      return { data: null, error: makeUnexpectedError(error, "DB_ERROR") }
    }
  }
}

let desktopServicePromise: Promise<DocumentService> | null = null

export async function getDocumentService(): Promise<DocumentService> {
  if (!isDesktopRuntime()) {
    return webDocumentService
  }

  if (!desktopServicePromise) {
    desktopServicePromise = resolveDesktopRuntimeServices().then(
      (runtime) => new DesktopDocumentService(runtime),
    )
  }

  return desktopServicePromise
}

export async function createDesktopDraft(
  options: DesktopDraftOptions = {},
): Promise<ServiceResponse<WritingRecord>> {
  const documentService = await getDocumentService()

  if (!(documentService instanceof DesktopDocumentService)) {
    return err("UNAVAILABLE", "Desktop draft creation is only available in the desktop runtime")
  }

  return documentService.createDraft(options)
}

export async function relocateDesktopWriting(writingId: string, newPath: string): Promise<void> {
  const existing = await localDB.writings.get(writingId)
  if (!existing) return
  await enqueueWritingUpsert({ ...existing, canonical_path: newPath, local_updated_at: Date.now() })
}

export async function relocateDesktopWritingByCanonicalPath(
  previousPath: string,
  nextPath: string,
): Promise<void> {
  const existing = await localDB.writings.getByCanonicalPath(previousPath)
  if (!existing || existing.canonical_path === nextPath) {
    return
  }

  await enqueueWritingUpsert({
    ...existing,
    canonical_path: nextPath,
    local_updated_at: Date.now(),
  })
}

export async function markDesktopWritingDeletedByCanonicalPath(
  canonicalPath: string,
): Promise<void> {
  const existing = await localDB.writings.getByCanonicalPath(canonicalPath)
  if (!existing || existing.sync_status === "deleted") {
    return
  }

  await enqueueWritingDelete(existing.id)
}

export async function importDesktopWritingFile(
  path: string,
  content: string,
): Promise<ServiceResponse<WritingRecord>> {
  const parsed = desktopDocumentEngine.parseSourceDocument(content)
  if (!parsed.success) {
    return err("INVALID_INPUT", parsed.error)
  }

  const metadata = parsed.document.metadata
  const title = deriveDraftTitleFromPlainText(parsed.document.snapshot.bodyText, "Imported writing")

  const result = await createDesktopDraft({
    writingId: metadata?.id ?? createWritingId(),
    title,
    slug: metadata?.slug ?? null,
    status: metadata?.status ?? "draft",
    visibility: metadata?.visibility ?? "private",
    preferredPath: path,
    initialBodyJson: parsed.document.snapshot.bodyJson as Record<string, unknown>,
    initialBodyText: parsed.document.snapshot.bodyText,
  })

  if (result.error || !result.data) {
    return result
  }

  return ok(result.data)
}
