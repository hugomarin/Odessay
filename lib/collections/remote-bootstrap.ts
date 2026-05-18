import { localDB } from "@/lib/local-db";
import type {
  CollectionVisibility,
  LocalCollection,
} from "@/lib/local-db/schema";

type ApiEnvelope<T> = {
  data: T;
  error: { code: string; message: string } | null;
};

export type RemoteCollectionRecord = {
  id: string;
  owner_id: string;
  name: string | null;
  description: string | null;
  visibility: CollectionVisibility | null;
  created_at: string;
  updated_at: string;
};

export type RemoteWritingCollectionRecord = {
  collection_id: string;
  writing_id: string;
  added_at: string | null;
};

export type RemoteCollectionsBootstrap = {
  collections: RemoteCollectionRecord[];
  writingCollections: RemoteWritingCollectionRecord[];
};

const parseTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const parseEnvelope = async <T>(response: Response): Promise<T> => {
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || envelope.error) {
    throw new Error(envelope.error?.message ?? `Request failed with status ${response.status}.`);
  }

  return envelope.data;
};

const normalizeVisibility = (value: string | null | undefined): CollectionVisibility =>
  value === "public" ? "public" : "private";

const toLocalCollection = (remote: RemoteCollectionRecord): LocalCollection => {
  const updatedAtMs = parseTimestamp(remote.updated_at);

  return {
    id: remote.id,
    owner_id: remote.owner_id,
    name: remote.name?.trim() || "Untitled collection",
    description: remote.description ?? null,
    visibility: normalizeVisibility(remote.visibility),
    sync_status: "synced",
    lifecycle: "server-confirmed",
    deleted_at: null,
    created_at: remote.created_at,
    updated_at: remote.updated_at,
    local_updated_at: updatedAtMs || Date.now(),
  };
};

let inFlightCollectionsHydration: Promise<RemoteCollectionsBootstrap> | null = null;

export const hydrateLocalCollectionsFromRemote = (): Promise<RemoteCollectionsBootstrap> => {
  if (inFlightCollectionsHydration) {
    return inFlightCollectionsHydration;
  }

  const promise = (async () => {
    const response = await fetch("/api/collections", {
      method: "GET",
      cache: "no-store",
    });
    const payload = await parseEnvelope<RemoteCollectionsBootstrap>(response);

    for (const collection of payload.collections) {
      const localCollection = await localDB.collections.get(collection.id);
      const hasPendingMutation = await localDB.syncQueue.getCurrentForEntity(
        "collection",
        collection.id,
      );

      if (
        localCollection &&
        (localCollection.sync_status === "pending" ||
          localCollection.sync_status === "failed" ||
          hasPendingMutation ||
          localCollection.local_updated_at > parseTimestamp(collection.updated_at))
      ) {
        continue;
      }

      await localDB.collections.save(toLocalCollection(collection));
    }

    const writingIds = Array.from(
      new Set(payload.writingCollections.map((assignment) => assignment.writing_id)),
    );
    const assignmentsByWriting = new Map<string, string[]>();

    for (const writingId of writingIds) {
      assignmentsByWriting.set(writingId, []);
    }

    for (const assignment of payload.writingCollections) {
      assignmentsByWriting.get(assignment.writing_id)?.push(assignment.collection_id);
    }

    for (const writingId of writingIds) {
      const pendingMutation = await localDB.syncQueue.getCurrentForEntity(
        "writing-collections",
        writingId,
      );

      if (pendingMutation) {
        continue;
      }

      await localDB.writingCollections.replaceForWriting(
        writingId,
        assignmentsByWriting.get(writingId) ?? [],
      );
    }

    return payload;
  })().finally(() => {
    inFlightCollectionsHydration = null;
  });

  inFlightCollectionsHydration = promise;
  return promise;
};
