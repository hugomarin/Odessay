import { localDB } from "@/lib/local-db";
import { createEntityKey } from "@/lib/local-db";
import type {
  LocalCollection,
  LocalWriting,
  RemoteWritingPayload,
  SyncMutation,
} from "@/lib/local-db/schema";
import { emitSyncStatusChange } from "@/lib/sync/events";
import { getSyncWorker } from "@/lib/sync/worker";

const createMutationId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `mutation-${Date.now()}`;
};

const toRemotePayload = (writing: LocalWriting): RemoteWritingPayload => ({
  author_id: writing.author_id ?? null,
  title: writing.title ?? null,
  body_json: writing.body_json,
  body_text: writing.body_text,
  slug: writing.slug ?? null,
  status: writing.status,
  visibility: writing.visibility,
  parent_id: writing.parent_id ?? null,
  correspondence_id: writing.correspondence_id ?? null,
  version: writing.version,
  updated_at: writing.updated_at,
  deleted_at: writing.deleted_at ?? null,
});

export const enqueueMutation = async (
  writing: LocalWriting,
  operation: Extract<SyncMutation, { entity_kind: "writing" }>["operation"] = "upsert",
) => {
  await localDB.syncQueue.enqueue({
    id: createMutationId(),
    entity_kind: "writing",
    entity_id: writing.id,
    entity_key: createEntityKey("writing", writing.id),
    operation,
    payload: toRemotePayload(writing),
    created_at: Date.now(),
    attempts: 0,
  });

  emitSyncStatusChange({
    writingId: writing.id,
    status: "pending",
  });

  getSyncWorker().schedule();
};

export const enqueueWritingUpsert = async (writing: LocalWriting) => {
  await localDB.writings.save({
    ...writing,
    local_updated_at: Date.now(),
    sync_status: "pending",
  });
  await enqueueMutation(writing, "upsert");
};

export const enqueueWritingDelete = async (writingId: string) => {
  const writing = await localDB.writings.get(writingId);

  if (!writing) {
    return;
  }

  await localDB.writings.delete(writingId);
  const deletedWriting = await localDB.writings.get(writingId);

  if (!deletedWriting) {
    return;
  }

  await enqueueMutation(deletedWriting, "delete");
};

export const markCollectionPending = async (collection: LocalCollection) => {
  await localDB.collections.save({
    ...collection,
    sync_status: "pending",
    local_updated_at: Date.now(),
  });
};
