import { createEntityKey, localDB } from "@/lib/local-db";
import {
  type CollectionVisibility,
  type LocalCollection,
  type LocalWritingCollection,
} from "@/lib/local-db/schema";

const nowIso = () => new Date().toISOString();

const createCollectionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `collection-${Date.now()}`;
};

export const createLocalCollection = async ({
  ownerId,
  name,
  description,
  visibility = "private",
}: {
  ownerId?: string | null;
  name: string;
  description?: string | null;
  visibility?: CollectionVisibility;
}) => {
  const timestamp = nowIso();
  const collection: LocalCollection = {
    id: createCollectionId(),
    owner_id: ownerId ?? null,
    name: name.trim(),
    description: description?.trim() || null,
    visibility,
    sync_status: "pending",
    lifecycle: "local-only",
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    local_updated_at: Date.now(),
  };

  await localDB.collections.save(collection);
  await localDB.syncQueue.enqueue({
    id: `mutation-${collection.id}-${Date.now()}`,
    entity_kind: "collection",
    entity_id: collection.id,
    entity_key: createEntityKey("collection", collection.id),
    operation: "upsert",
    payload: {
      owner_id: collection.owner_id ?? null,
      name: collection.name,
      description: collection.description ?? null,
      visibility: collection.visibility,
      updated_at: collection.updated_at,
    },
    created_at: Date.now(),
    attempts: 0,
  });

  return collection;
};

export const updateLocalCollection = async (
  current: LocalCollection,
  updates: Partial<Pick<LocalCollection, "name" | "description" | "visibility">>,
) => {
  const nextCollection: LocalCollection = {
    ...current,
    name: updates.name?.trim() ?? current.name,
    description:
      updates.description !== undefined
        ? updates.description?.trim() || null
        : current.description ?? null,
    visibility: updates.visibility ?? current.visibility,
    sync_status: "pending",
    updated_at: nowIso(),
    local_updated_at: Date.now(),
  };

  await localDB.collections.save(nextCollection);
  await localDB.syncQueue.enqueue({
    id: `mutation-${nextCollection.id}-${Date.now()}`,
    entity_kind: "collection",
    entity_id: nextCollection.id,
    entity_key: createEntityKey("collection", nextCollection.id),
    operation: "upsert",
    payload: {
      owner_id: nextCollection.owner_id ?? null,
      name: nextCollection.name,
      description: nextCollection.description ?? null,
      visibility: nextCollection.visibility,
      updated_at: nextCollection.updated_at,
    },
    created_at: Date.now(),
    attempts: 0,
  });

  return nextCollection;
};

export const deleteLocalCollection = async (collection: LocalCollection) => {
  await localDB.collections.delete(collection.id);
  await localDB.syncQueue.enqueue({
    id: `mutation-${collection.id}-${Date.now()}`,
    entity_kind: "collection",
    entity_id: collection.id,
    entity_key: createEntityKey("collection", collection.id),
    operation: "delete",
    payload: {
      owner_id: collection.owner_id ?? null,
      name: collection.name,
      description: collection.description ?? null,
      visibility: collection.visibility,
      updated_at: nowIso(),
    },
    created_at: Date.now(),
    attempts: 0,
  });
};

export const setLocalWritingCollections = async (
  writingId: string,
  collectionIds: string[],
) => {
  const nextIds = Array.from(new Set(collectionIds));

  await localDB.writingCollections.replaceForWriting(writingId, nextIds);
  await localDB.syncQueue.enqueue({
    id: `mutation-writing-collections-${writingId}-${Date.now()}`,
    entity_kind: "writing-collections",
    entity_id: writingId,
    entity_key: createEntityKey("writing-collections", writingId),
    operation: "set",
    payload: {
      collection_ids: nextIds,
      updated_at: nowIso(),
    },
    created_at: Date.now(),
    attempts: 0,
  });
};

export const listWritingCollections = (writingId: string): Promise<LocalWritingCollection[]> =>
  localDB.writingCollections.listForWriting(writingId);
