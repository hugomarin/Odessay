import type {
  DocumentService,
  ExportedDocumentArtifact,
  ListWritingsInput,
  RenameWritingInput,
  SaveWritingInput,
  DeleteWritingInput,
  ExportWritingInput,
  SetWritingCollectionsInput,
  WritingCollectionMembership,
  WritingRecord,
  WritingSummary,
} from "@/lib/services/contracts/document-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { enqueueWritingDelete, enqueueWritingUpsert } from "@/lib/sync/queue"
import { needsBodyHydration } from "@/lib/sync/remote-bootstrap"
import { getSyncService } from "@/lib/sync/sync-service-factory"

function localWritingToRecord(local: LocalWriting): WritingRecord {
  return {
    id: local.id,
    authorId: local.author_id ?? null,
    title: local.title ?? null,
    content: {
      richText: local.body_json,
      markdown: null,
      plainText: local.body_text,
      canonicalSource: "rich-text",
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

function recordToLocalWriting(record: WritingRecord): LocalWriting {
  return {
    id: record.id,
    author_id: record.authorId,
    title: record.title,
    body_json: record.content.richText ?? { type: "doc", content: [] },
    body_text: record.content.plainText,
    slug: record.slug,
    status: record.status,
    visibility: record.visibility,
    parent_id: record.parentId,
    correspondence_id: record.correspondenceId,
    version: record.version,
    sync_status: "pending",
    lifecycle: "local-only",
    deleted_at: record.deletedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    local_updated_at: Date.now(),
  }
}

function makeServiceError(error: unknown, fallbackCode: ServiceError["code"]): ServiceError {
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Unexpected error",
    retryable: fallbackCode === "DB_ERROR" || fallbackCode === "UNAVAILABLE",
  }
}

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(error: ServiceError): ServiceResponse<T> {
  return { data: null, error }
}

export const webDocumentService: DocumentService = {
  async listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>> {
    try {
      const locals = await localDB.writings.getAll({ includeDeleted: input?.includeDeleted })
      const summaries: WritingSummary[] = locals.map((local) => ({
        id: local.id,
        authorId: local.author_id ?? null,
        title: local.title ?? null,
        slug: local.slug ?? null,
        status: local.status,
        visibility: local.visibility,
        parentId: local.parent_id ?? null,
        correspondenceId: local.correspondence_id ?? null,
        version: local.version,
        deletedAt: local.deleted_at ?? null,
        createdAt: local.created_at,
        updatedAt: local.updated_at,
        excerpt: local.body_text?.slice(0, 200) ?? null,
      }))
      return ok(summaries)
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async openWriting(writingId: string): Promise<ServiceResponse<WritingRecord>> {
    try {
      let local = await localDB.writings.get(writingId)

      if (!local || needsBodyHydration(local)) {
        try {
          await getSyncService().hydrateWriting({ writingId })
          local = await localDB.writings.get(writingId)
        } catch {
          // fall through to not-found handling
        }
      }

      if (!local) {
        return err({
          code: "NOT_FOUND",
          message: `Writing ${writingId} not found`,
          retryable: false,
        })
      }

      return ok(localWritingToRecord(local))
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async saveWriting(input: SaveWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const existing = await localDB.writings.get(input.writing.id)
      const local = recordToLocalWriting(input.writing)
      if (existing) {
        local.lifecycle = existing.lifecycle
      }
      await enqueueWritingUpsert(local)
      return ok(localWritingToRecord(local))
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async renameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const local = await localDB.writings.get(input.writingId)

      if (!local) {
        return err({
          code: "NOT_FOUND",
          message: `Writing ${input.writingId} not found`,
          retryable: false,
        })
      }

      const nextLocal: LocalWriting = {
        ...local,
        title: input.title,
        updated_at: input.updatedAt,
        local_updated_at: Date.now(),
        sync_status: "pending",
      }

      await enqueueWritingUpsert(nextLocal)
      return ok(localWritingToRecord(nextLocal))
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async deleteWriting(input: DeleteWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const local = await localDB.writings.get(input.writingId)

      if (!local) {
        return err({
          code: "NOT_FOUND",
          message: `Writing ${input.writingId} not found`,
          retryable: false,
        })
      }

      await enqueueWritingDelete(input.writingId)
      return ok(localWritingToRecord(local))
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async listWritingCollections(writingId: string): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    try {
      const rows = await localDB.writingCollections.listForWriting(writingId)
      const memberships: WritingCollectionMembership[] = rows.map((row) => ({
        collectionId: row.collection_id,
        addedAt: row.added_at,
      }))
      return ok(memberships)
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async setWritingCollections(input: SetWritingCollectionsInput): Promise<ServiceResponse<WritingCollectionMembership[]>> {
    try {
      await localDB.writingCollections.replaceForWriting(input.writingId, input.collectionIds)
      const rows = await localDB.writingCollections.listForWriting(input.writingId)
      const memberships: WritingCollectionMembership[] = rows.map((row) => ({
        collectionId: row.collection_id,
        addedAt: row.added_at,
      }))
      return ok(memberships)
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async exportWriting(input: ExportWritingInput): Promise<ServiceResponse<ExportedDocumentArtifact>> {
    try {
      const response = await fetch(
        `/api/writings/${encodeURIComponent(input.writingId)}/export?format=${encodeURIComponent(input.format)}`,
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
        return err({
          code: "UNAVAILABLE",
          message: payload?.error?.message ?? `Failed to export ${input.format.toUpperCase()}`,
          retryable: false,
        })
      }

      const blob = await response.blob()
      const arrayBuffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      const contentType =
        input.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

      const local = await localDB.writings.get(input.writingId)
      const title = local?.title?.trim() || input.writingId.slice(0, 8)

      return ok({
        writingId: input.writingId,
        format: input.format,
        fileName: `${title}.${input.format}`,
        mimeType: contentType,
        bytes,
      })
    } catch (error) {
      return err(makeServiceError(error, "UNAVAILABLE"))
    }
  },
}
