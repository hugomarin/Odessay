import type {
  DocumentService,
  ExportedDocumentArtifact,
  ListWritingsInput,
  RenameWritingInput,
  SaveWritingInput,
  UpdateWritingMetadataInput,
  DeleteWritingInput,
  ExportWritingInput,
  SetWritingCollectionsInput,
  WritingCollectionMembership,
  WritingRecord,
  WritingSummary,
  RestoreWritingInput,
  PermanentlyDeleteWritingInput,
  DownloadWritingInput,
} from "@/lib/services/contracts/document-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { normalizeArtifactType } from "@/lib/writings/artifact-type"
import { getExportFileBaseName } from "@/lib/export/writing-export"
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
    artifactType: normalizeArtifactType(local.artifact_type),
    visibility: local.visibility,
    parentId: local.parent_id ?? null,
    correspondenceId: local.correspondence_id ?? null,
    version: local.version,
    deletedAt: local.deleted_at ?? null,
    createdAt: local.created_at,
    updatedAt: local.updated_at,
    contentUpdatedAt: local.content_updated_at ?? null,
    metadataUpdatedAt: local.metadata_updated_at ?? null,
    lifecycle: local.lifecycle,
  }
}

function recordToLocalWriting(record: WritingRecord, existing?: LocalWriting | null): LocalWriting {
  return {
    id: record.id,
    author_id: record.authorId,
    title: record.title,
    body_json: record.content.richText ?? { type: "doc", content: [] },
    body_text: record.content.plainText,
    slug: record.slug,
    status: record.status,
    artifact_type: record.artifactType,
    visibility: record.visibility,
    parent_id: record.parentId,
    correspondence_id: record.correspondenceId,
    version: record.version,
    sync_status: "pending",
    lifecycle: "local-only",
    deleted_at: record.deletedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    content_updated_at: record.contentUpdatedAt ?? existing?.content_updated_at ?? record.updatedAt,
    metadata_updated_at: record.metadataUpdatedAt ?? existing?.metadata_updated_at ?? record.updatedAt,
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
      if (input?.archivedOnly) {
        const response = await fetch(`/api/writings/archived?limit=${input.limit ?? 25}&offset=${input.offset ?? 0}`)
        const payload = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>>; error?: { message?: string } } | null
        if (!response.ok) return err({ code: response.status === 401 ? "UNAUTHORIZED" : "UNAVAILABLE", message: payload?.error?.message ?? "Could not load archived writings", retryable: response.status >= 500 })
        return ok((payload?.data ?? []).map((row) => ({
          id: String(row.id), authorId: String(row.author_id), title: row.title == null ? null : String(row.title),
          slug: row.slug == null ? null : String(row.slug), status: row.status as WritingRecord["status"],
          artifactType: normalizeArtifactType(typeof row.artifact_type === "string" ? row.artifact_type : null), visibility: row.visibility as WritingRecord["visibility"],
          parentId: row.parent_id == null ? null : String(row.parent_id), correspondenceId: row.correspondence_id == null ? null : String(row.correspondence_id),
          version: Number(row.version), deletedAt: String(row.deleted_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at), excerpt: null,
          archiveState: "archived",
        })))
      }
      const locals = await localDB.writings.getAll({ includeDeleted: input?.includeDeleted })
      const summaries: WritingSummary[] = locals
        .filter((local) => !input?.archivedOnly || Boolean(local.deleted_at))
        .map((local) => ({
          id: local.id,
          authorId: local.author_id ?? null,
          title: local.title ?? null,
          slug: local.slug ?? null,
          status: local.status,
          artifactType: normalizeArtifactType(local.artifact_type),
          visibility: local.visibility,
          parentId: local.parent_id ?? null,
          correspondenceId: local.correspondence_id ?? null,
          version: local.version,
          deletedAt: local.deleted_at ?? null,
          createdAt: local.created_at,
          updatedAt: local.updated_at,
          contentUpdatedAt: local.content_updated_at ?? null,
          metadataUpdatedAt: local.metadata_updated_at ?? null,
          excerpt: local.body_text?.slice(0, 200) ?? null,
          archiveState: local.deleted_at
            ? (local.sync_status === "pending" ? "pending-deletion" : local.sync_status === "failed" ? "error" : "archived") as WritingSummary["archiveState"]
            : undefined,
        }))
        .sort((left, right) => new Date(right.deletedAt ?? right.createdAt).getTime() - new Date(left.deletedAt ?? left.createdAt).getTime())
      return ok(summaries.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? summaries.length)))
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
      const local = recordToLocalWriting(input.writing, existing)
      if (existing) {
        local.lifecycle = existing.lifecycle
      }
      await enqueueWritingUpsert(local)
      return ok(localWritingToRecord(local))
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async updateWritingMetadata(input: UpdateWritingMetadataInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const existing = await localDB.writings.get(input.writingId)
      if (!existing || existing.sync_status === "deleted") return err({
        code: "NOT_FOUND",
        message: `Writing ${input.writingId} not found`,
        retryable: false,
      })
      const next = {
        ...existing,
        ...(input.status ? { status: input.status } : {}),
        ...(input.artifactType ? { artifact_type: input.artifactType } : {}),
        version: input.version,
        updated_at: input.updatedAt,
        metadata_updated_at: input.updatedAt,
        local_updated_at: Date.now(),
      }
      await enqueueWritingUpsert(next)
      return ok(localWritingToRecord(next))
    } catch (error) {
      return err(makeServiceError(error, "DB_ERROR"))
    }
  },

  async updateWritingsMetadata(input) {
    const updated: WritingRecord[] = []
    for (const change of input.updates) {
      const result = await this.updateWritingMetadata(change)
      if (result.error || !result.data) return { data: null, error: result.error }
      updated.push(result.data)
    }
    return ok(updated)
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
        content_updated_at: input.updatedAt,
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

  async restoreWriting(input: RestoreWritingInput): Promise<ServiceResponse<WritingRecord>> {
    try {
      const response = await fetch(`/api/writings/${encodeURIComponent(input.writingId)}/lifecycle`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", updated_at: input.updatedAt }),
      })
      const payload = await response.json().catch(() => null) as { data?: Record<string, unknown>; error?: { message?: string } } | null
      if (!response.ok || !payload?.data) return err({ code: response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", message: payload?.error?.message ?? "Restore failed", retryable: response.status >= 500 })
      const local = await localDB.writings.get(input.writingId)
      if (!local) return ok({
        id: input.writingId, authorId: String(payload.data.author_id ?? ""), title: payload.data.title == null ? null : String(payload.data.title),
        content: { markdown: null, richText: null, plainText: "", canonicalSource: "pending-document-contract" },
        slug: payload.data.slug == null ? null : String(payload.data.slug), status: (payload.data.status ?? "draft") as WritingRecord["status"],
        artifactType: normalizeArtifactType(typeof payload.data.artifact_type === "string" ? payload.data.artifact_type : null), visibility: (payload.data.visibility ?? "private") as WritingRecord["visibility"],
        parentId: payload.data.parent_id == null ? null : String(payload.data.parent_id), correspondenceId: payload.data.correspondence_id == null ? null : String(payload.data.correspondence_id),
        version: Number(payload.data.version ?? 1), deletedAt: null, createdAt: String(payload.data.created_at ?? input.updatedAt), updatedAt: String(payload.data.updated_at ?? input.updatedAt), lifecycle: "server-confirmed",
      })
      const restored: LocalWriting = { ...local, deleted_at: null, sync_status: "synced", lifecycle: "server-confirmed", updated_at: input.updatedAt, local_updated_at: Date.now() }
      await localDB.syncQueue.deleteForEntity("writing", input.writingId)
      await localDB.writings.save(restored)
      return ok(localWritingToRecord(restored))
    } catch (error) { return err(makeServiceError(error, "UNAVAILABLE")) }
  },

  async permanentlyDeleteWriting(input: PermanentlyDeleteWritingInput): Promise<ServiceResponse<void>> {
    try {
      const response = await fetch(`/api/writings/${encodeURIComponent(input.writingId)}/lifecycle`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete-permanently" }),
      })
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
      if (!response.ok) return err({ code: response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", message: payload?.error?.message ?? "Permanent deletion failed", retryable: response.status >= 500 })
      await localDB.writings.purge?.(input.writingId)
      return ok(undefined)
    } catch (error) { return err(makeServiceError(error, "UNAVAILABLE")) }
  },

  async downloadWriting(input: DownloadWritingInput): Promise<ServiceResponse<ExportedDocumentArtifact>> {
    try {
      const response = await fetch(`/api/writings/${encodeURIComponent(input.writingId)}/lifecycle?action=download`)
      if (!response.ok) return err({ code: response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", message: "Download failed", retryable: response.status >= 500 })
      const bytes = new Uint8Array(await response.arrayBuffer())
      const disposition = response.headers.get("content-disposition") ?? ""
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${input.writingId}.md`
      return ok({ writingId: input.writingId, format: "markdown", fileName, mimeType: "text/markdown", bytes })
    } catch (error) { return err(makeServiceError(error, "UNAVAILABLE")) }
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
      const fileBaseName = getExportFileBaseName({
        title: local?.title,
        bodyText: local?.body_text,
        writingId: input.writingId,
      })

      return ok({
        writingId: input.writingId,
        format: input.format,
        fileName: `${fileBaseName}.${input.format}`,
        mimeType: contentType,
        bytes,
      })
    } catch (error) {
      return err(makeServiceError(error, "UNAVAILABLE"))
    }
  },
}
