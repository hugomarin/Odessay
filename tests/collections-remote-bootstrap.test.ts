import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateLocalCollectionsFromRemote } from "../lib/collections/remote-bootstrap";
import { createEntityKey, localDB, setLocalDBScope } from "../lib/local-db";
import type {
  LocalCollection,
  SyncMutation,
} from "../lib/local-db/schema";

const makeCollection = (
  id: string,
  overrides: Partial<LocalCollection> = {},
): LocalCollection => ({
  id,
  owner_id: "user-1",
  name: `Collection ${id}`,
  description: null,
  visibility: "private",
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-04-21T00:00:00.000Z",
  updated_at: "2026-04-21T00:00:00.000Z",
  local_updated_at: 1,
  ...overrides,
});

const makeMutation = (
  writingId: string,
  collectionIds: string[],
): Extract<SyncMutation, { entity_kind: "writing-collections" }> => ({
  id: `mutation-${writingId}`,
  entity_kind: "writing-collections",
  entity_id: writingId,
  entity_key: createEntityKey("writing-collections", writingId),
  operation: "set",
  payload: {
    collection_ids: collectionIds,
    updated_at: "2026-04-21T00:00:00.000Z",
  },
  created_at: 1,
  attempts: 0,
});

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  setLocalDBScope(`collections-bootstrap-${crypto.randomUUID()}`);
});

describe("hydrateLocalCollectionsFromRemote", () => {
  it("does not overwrite pending local collections", async () => {
    await localDB.collections.save(
      makeCollection("collection-pending", {
        name: "Local pending name",
        sync_status: "pending",
        lifecycle: "local-only",
        local_updated_at: 100,
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              collections: [
                {
                  id: "collection-pending",
                  owner_id: "user-1",
                  name: "Remote name",
                  description: null,
                  visibility: "public",
                  created_at: "2026-04-21T00:00:00.000Z",
                  updated_at: "2026-04-22T00:00:00.000Z",
                },
              ],
              writingCollections: [],
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await hydrateLocalCollectionsFromRemote();

    const stored = await localDB.collections.get("collection-pending");
    expect(stored?.name).toBe("Local pending name");
    expect(stored?.visibility).toBe("private");
    expect(stored?.sync_status).toBe("pending");
  });

  it("does not overwrite pending writing-collection assignments", async () => {
    await localDB.writingCollections.replaceForWriting("writing-1", ["collection-local"]);
    await localDB.syncQueue.enqueue(makeMutation("writing-1", ["collection-local"]));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              collections: [],
              writingCollections: [
                {
                  writing_id: "writing-1",
                  collection_id: "collection-remote",
                  added_at: "2026-04-22T00:00:00.000Z",
                },
                {
                  writing_id: "writing-2",
                  collection_id: "collection-remote-2",
                  added_at: "2026-04-22T00:00:00.000Z",
                },
              ],
            },
            error: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await hydrateLocalCollectionsFromRemote();

    const pendingAssignments = await localDB.writingCollections.listForWriting("writing-1");
    const syncedAssignments = await localDB.writingCollections.listForWriting("writing-2");

    expect(pendingAssignments.map((assignment) => assignment.collection_id)).toEqual([
      "collection-local",
    ]);
    expect(syncedAssignments.map((assignment) => assignment.collection_id)).toEqual([
      "collection-remote-2",
    ]);
  });
});
