import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEntityKey, localDB, setLocalDBScope, subscribeToLocalDBScopeChanges } from "../lib/local-db";
import { createEmptyEditorSession } from "../lib/local-db/editor-sessions";
import type { LocalWriting, SyncMutation } from "../lib/local-db/schema";

const createWriting = (id: string, version: number): LocalWriting => ({
  id,
  title: "Untitled writing",
  body_json: {
    type: "doc",
  },
  body_text: `Draft ${version}`,
  status: "draft",
  visibility: "private",
  version,
  sync_status: "pending",
  lifecycle: "local-only",
  created_at: "2026-03-17T00:00:00.000Z",
  updated_at: "2026-03-17T00:00:00.000Z",
  local_updated_at: version,
});

const createMutation = (id: string, writingId: string, version: number): SyncMutation => ({
  id,
  entity_kind: "writing",
  entity_id: writingId,
  entity_key: createEntityKey("writing", writingId),
  operation: "upsert",
  payload: {
    body_json: {
      type: "doc",
    },
    body_text: `Draft ${version}`,
    status: "draft",
    visibility: "private",
    version,
    updated_at: "2026-03-17T00:00:00.000Z",
  },
  created_at: version,
  attempts: 0,
});

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
});

describe("localDB", () => {
  it("isolates writings by user scope", async () => {
    setLocalDBScope("user-a");
    await localDB.writings.save(createWriting("writing-a", 1));

    setLocalDBScope("user-b");
    expect(await localDB.writings.get("writing-a")).toBeNull();

    await localDB.writings.save(createWriting("writing-b", 1));
    expect(await localDB.writings.get("writing-b")).not.toBeNull();

    setLocalDBScope("user-a");
    expect(await localDB.writings.get("writing-a")).not.toBeNull();
    expect(await localDB.writings.get("writing-b")).toBeNull();
  });

  it("compacts sync mutations by writing id", async () => {
    setLocalDBScope("queue-user");

    await localDB.syncQueue.enqueue(createMutation("mutation-1", "writing-1", 1));
    await localDB.syncQueue.enqueue(createMutation("mutation-2", "writing-1", 2));

    const pending = await localDB.syncQueue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("mutation-2");

    const current = await localDB.syncQueue.getCurrentForWriting("writing-1");
    expect(current?.id).toBe("mutation-2");
    expect(current?.entity_kind).toBe("writing");
    expect(current && current.entity_kind === "writing" ? current.payload.version : null).toBe(2);
  });

  it("notifies listeners when the local DB scope changes", () => {
    const onScopeChange = vi.fn();
    const unsubscribe = subscribeToLocalDBScopeChanges(onScopeChange);
    const firstScope = `scope-${Date.now()}`;
    const secondScope = `${firstScope}-next`;

    setLocalDBScope(firstScope);
    setLocalDBScope(firstScope);
    setLocalDBScope(secondScope);
    unsubscribe();
    setLocalDBScope(`${secondScope}-ignored`);

    expect(onScopeChange).toHaveBeenCalledTimes(2);
    expect(onScopeChange).toHaveBeenNthCalledWith(1, firstScope);
    expect(onScopeChange).toHaveBeenNthCalledWith(2, secondScope);
  });

  it("persists editor workspace sessions per scope", async () => {
    setLocalDBScope("editor-user-a");
    await localDB.editorSessions.save({
      ...createEmptyEditorSession(),
      active_tab_id: "writing-a",
    });

    setLocalDBScope("editor-user-b");
    expect(await localDB.editorSessions.get("workspace")).toBeNull();

    await localDB.editorSessions.save({
      ...createEmptyEditorSession(),
      active_tab_id: "writing-b",
    });

    setLocalDBScope("editor-user-a");
    expect((await localDB.editorSessions.get("workspace"))?.active_tab_id).toBe("writing-a");
  });
});
