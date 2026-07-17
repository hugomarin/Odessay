import {
  tauriCatalogApplyCollectionSnapshot,
  tauriCatalogDeleteCollection,
  tauriCatalogListCollectionSnapshot,
  tauriCatalogReplaceWritingCollections,
  tauriCatalogSaveCollection,
  type DesktopCatalogCollection,
  type DesktopCatalogMetadataMutation,
} from "@/lib/services/desktop/tauri-commands"

type LocalCollection = {
  id: string; owner_id?: string | null; name: string; description?: string | null
  visibility: "private" | "public"; sync_status: "synced" | "pending" | "failed" | "deleted"
  lifecycle: "local-only" | "syncing" | "server-confirmed"; deleted_at?: string | null
  created_at: string; updated_at: string; local_updated_at: number
}
type LocalWritingCollection = {
  id: string; writing_id: string; collection_id: string; added_at: string; local_updated_at: number
}

let dbPathPromise: Promise<string> | null = null
async function dbPath() {
  dbPathPromise ??= (async () => {
    const { appConfigDir, join } = await import("@tauri-apps/api/path")
    return join(await appConfigDir(), "desktop-index.sqlite3")
  })()
  return dbPathPromise
}

function toDesktopCollection(collection: LocalCollection): DesktopCatalogCollection {
  return {
    id: collection.id, ownerId: collection.owner_id ?? null, name: collection.name,
    description: collection.description ?? null, visibility: collection.visibility,
    syncStatus: collection.sync_status, lifecycle: collection.lifecycle,
    deletedAt: collection.deleted_at ?? null, createdAt: collection.created_at,
    updatedAt: collection.updated_at, localUpdatedAt: collection.local_updated_at,
  }
}

function fromDesktopCollection(collection: DesktopCatalogCollection): LocalCollection {
  return {
    id: collection.id, owner_id: collection.ownerId, name: collection.name,
    description: collection.description, visibility: collection.visibility,
    sync_status: collection.syncStatus as LocalCollection["sync_status"],
    lifecycle: collection.lifecycle as LocalCollection["lifecycle"], deleted_at: collection.deletedAt,
    created_at: collection.createdAt, updated_at: collection.updatedAt,
    local_updated_at: collection.localUpdatedAt,
  }
}

function mutation(
  entityKind: DesktopCatalogMetadataMutation["entityKind"],
  entityId: string,
  operation: DesktopCatalogMetadataMutation["operation"],
  payload: Record<string, unknown>,
): DesktopCatalogMetadataMutation {
  return {
    id: crypto.randomUUID(), entityKind, entityId, operation, payloadJson: JSON.stringify(payload),
    status: "pending", attemptCount: 0, nextRetryAt: null, createdAt: Date.now(), lastError: null,
  }
}

export async function loadDesktopCollections() {
  const snapshot = await tauriCatalogListCollectionSnapshot(await dbPath())
  return {
    collections: snapshot.collections.map(fromDesktopCollection),
    writingCollections: snapshot.writingCollections.map((row): LocalWritingCollection => ({
      id: `${row.writingId}:${row.collectionId}`, writing_id: row.writingId,
      collection_id: row.collectionId, added_at: row.addedAt, local_updated_at: row.localUpdatedAt,
    })),
  }
}

export async function applyDesktopCollectionSnapshot(
  collections: LocalCollection[],
  writingCollections: LocalWritingCollection[],
) {
  await tauriCatalogApplyCollectionSnapshot(await dbPath(), {
    collections: collections.map(toDesktopCollection),
    writingCollections: writingCollections.map((row) => ({
      writingId: row.writing_id, collectionId: row.collection_id,
      addedAt: row.added_at, localUpdatedAt: row.local_updated_at,
    })),
  })
}

export async function createDesktopCollection(input: {
  ownerId?: string | null; name: string; description?: string | null; visibility?: "private" | "public"
}) {
  const timestamp = new Date().toISOString()
  const collection: LocalCollection = {
    id: crypto.randomUUID(), owner_id: input.ownerId ?? null, name: input.name.trim(),
    description: input.description?.trim() || null, visibility: input.visibility ?? "private",
    sync_status: "pending", lifecycle: "local-only", deleted_at: null,
    created_at: timestamp, updated_at: timestamp, local_updated_at: Date.now(),
  }
  await tauriCatalogSaveCollection(await dbPath(), toDesktopCollection(collection), mutation(
    "collection", collection.id, "upsert", {
      owner_id: collection.owner_id, name: collection.name, description: collection.description,
      visibility: collection.visibility, updated_at: collection.updated_at,
    },
  ))
  return collection
}

export async function updateDesktopCollection(
  current: LocalCollection,
  updates: Partial<Pick<LocalCollection, "name" | "description" | "visibility">>,
) {
  const next: LocalCollection = {
    ...current, name: updates.name?.trim() ?? current.name,
    description: updates.description !== undefined ? updates.description?.trim() || null : current.description,
    visibility: updates.visibility ?? current.visibility, sync_status: "pending",
    updated_at: new Date().toISOString(), local_updated_at: Date.now(),
  }
  await tauriCatalogSaveCollection(await dbPath(), toDesktopCollection(next), mutation(
    "collection", next.id, "upsert", {
      owner_id: next.owner_id, name: next.name, description: next.description,
      visibility: next.visibility, updated_at: next.updated_at,
    },
  ))
  return next
}

export async function deleteDesktopCollection(collection: LocalCollection) {
  const deletedAt = new Date().toISOString()
  await tauriCatalogDeleteCollection(
    await dbPath(), collection.id, deletedAt, Date.now(),
    mutation("collection", collection.id, "delete", {
      owner_id: collection.owner_id, name: collection.name, description: collection.description,
      visibility: collection.visibility, updated_at: deletedAt,
    }),
  )
}

export async function setDesktopWritingCollections(writingId: string, collectionIds: string[]) {
  const ids = Array.from(new Set(collectionIds))
  const timestamp = new Date().toISOString()
  await tauriCatalogReplaceWritingCollections(
    await dbPath(), writingId, ids, timestamp, Date.now(),
    mutation("writing-collections", writingId, "set", { collection_ids: ids, updated_at: timestamp }),
  )
}
