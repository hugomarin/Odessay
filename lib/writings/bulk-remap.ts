import { localDB } from "@/lib/local-db"
import type { LocalWriting, WritingStatus } from "@/lib/local-db/schema"
import { enqueueWritingUpsert } from "@/lib/sync/queue"
import { webSyncService } from "@/lib/sync"

export type BulkRemapResult = {
  affectedCount: number
  errors: string[]
}

export async function bulkRemapStatusToDraft(
  fromStatus: WritingStatus,
): Promise<BulkRemapResult> {
  const allWritings = await localDB.writings.getAll()
  const affected = allWritings.filter(
    (writing) => writing.status === fromStatus && writing.sync_status !== "deleted",
  )

  const errors: string[] = []

  for (const writing of affected) {
    try {
      const updated: LocalWriting = {
        ...writing,
        status: "draft",
        version: writing.version + 1,
        updated_at: new Date().toISOString(),
        local_updated_at: Date.now(),
        sync_status: "pending",
      }
      await enqueueWritingUpsert(updated)
      void webSyncService.scheduleFlush()
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : `Failed to remap writing ${writing.id}`,
      )
    }
  }

  return {
    affectedCount: affected.length - errors.length,
    errors,
  }
}
