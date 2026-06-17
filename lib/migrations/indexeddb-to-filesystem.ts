import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { FilesystemDocumentService } from "@/lib/services/desktop/filesystem-document-service"

function ensureSourceMarkdown(writing: LocalWriting): string {
  const result = desktopDocumentEngine.serializeBodyJson((writing.body_json as Record<string, unknown>) ?? EMPTY_EDITOR_JSON)

  if (!result.success) {
    throw new Error(result.error)
  }

  return result.markdown
}

function deriveTitle(writing: LocalWriting) {
  const trimmed = writing.title?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : "Untitled"
}

type IndexedDbToFilesystemMigrationInput = {
  filesystem: FilesystemDocumentService
}

type IndexedDbToFilesystemMigrationResult = {
  migratedCount: number
  skippedCount: number
}

export async function migrateIndexedDbToFilesystem({
  filesystem,
}: IndexedDbToFilesystemMigrationInput): Promise<IndexedDbToFilesystemMigrationResult> {
  const writings = await localDB.writings.getAll({ includeDeleted: true })

  let migratedCount = 0
  let skippedCount = 0

  for (const writing of writings) {
    if (writing.sync_status === "deleted") {
      skippedCount += 1
      continue
    }

    const existingPath = writing.canonical_path?.trim()

    if (existingPath) {
      skippedCount += 1
      continue
    }

    const draftResult = await filesystem.createDraft(deriveTitle(writing))
    if (draftResult.error || !draftResult.data) {
      throw new Error(draftResult.error?.message ?? "Failed to allocate canonical desktop file")
    }

    const canonicalMarkdown = ensureSourceMarkdown(writing)
    const saveResult = await filesystem.saveWriting({
      writing: {
        ...draftResult.data.writing,
        id: draftResult.data.path,
        title: writing.title ?? draftResult.data.writing.title,
        content: {
          markdown: canonicalMarkdown,
          richText: null,
          plainText: writing.body_text,
          canonicalSource: "markdown",
        },
        status: writing.status,
        visibility: writing.visibility,
        version: Math.max(0, writing.version - 1),
        createdAt: writing.created_at,
        updatedAt: writing.updated_at,
      },
    })

    if (saveResult.error) {
      throw new Error(saveResult.error.message)
    }

    await localDB.writings.save({
      ...writing,
      canonical_path: draftResult.data.path,
      local_updated_at: Date.now(),
    })

    migratedCount += 1
  }

  return { migratedCount, skippedCount }
}
