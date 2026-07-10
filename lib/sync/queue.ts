import { localDB } from "@/lib/local-db";
import { createEntityKey } from "@/lib/local-db";
import { normalizeArtifactType } from "@/lib/writings/artifact-type";
import type {
  LocalCollection,
  LocalWriting,
  RemoteWritingPayload,
  SyncMutation,
} from "@/lib/local-db/schema";
import { computeWritingContentHash } from "@/lib/content-hash";
import { emitSyncStatusChange } from "@/lib/sync/events";
import { getSyncService } from "@/lib/sync/sync-service-factory";
import { scheduleDesktopCatalogDualWrite } from "@/lib/sync/catalog-dual-write";

const createMutationId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `mutation-${Date.now()}`;
};

export const toRemotePayload = async (writing: LocalWriting): Promise<RemoteWritingPayload> => ({
  author_id: writing.author_id ?? null,
  title: writing.title ?? null,
  body_json: writing.body_json,
  body_text: writing.body_text,
  content_hash: writing.content_hash ?? await computeWritingContentHash(writing.body_json),
  slug: writing.slug ?? null,
  status: writing.status,
  artifact_type: normalizeArtifactType(writing.artifact_type),
  visibility: writing.visibility,
  parent_id: writing.parent_id ?? null,
  correspondence_id: writing.correspondence_id ?? null,
  version: writing.version,
  updated_at: writing.updated_at,
  deleted_at: writing.deleted_at ?? null,
  // These columns are NOT NULL in the writings table. A brand-new draft may not
  // have them set yet, so fall back to updated_at (matching remote-bootstrap and
  // the local-db backfill) instead of sending null.
  content_updated_at: writing.content_updated_at ?? writing.updated_at,
  metadata_updated_at: writing.metadata_updated_at ?? writing.updated_at,
});

export const enqueueMutation = async (
  writing: LocalWriting,
  operation: Extract<SyncMutation, { entity_kind: "writing" }>["operation"] = "upsert",
) => {
  const mutation: Extract<SyncMutation, { entity_kind: "writing" }> = {
    id: createMutationId(),
    entity_kind: "writing",
    entity_id: writing.id,
    entity_key: createEntityKey("writing", writing.id),
    operation,
    payload: await toRemotePayload(writing),
    created_at: Date.now(),
    attempts: 0,
  };
  await localDB.syncQueue.enqueue(mutation);
  // M1 is additive: IndexedDB remains the read path and commits first. SQLite
  // dual-write is non-blocking and reports divergence instead of repairing it.
  scheduleDesktopCatalogDualWrite(writing, mutation);

  emitSyncStatusChange({
    writingId: writing.id,
    status: "pending",
  });

  void getSyncService().scheduleFlush();
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
