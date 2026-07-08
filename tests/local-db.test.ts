import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEntityKey,
  localDB,
  setLocalDBScope,
  subscribeToLocalDBScopeChanges,
} from "../lib/local-db";
import { createEmptyEditorSession } from "../lib/local-db/editor-sessions";
import type { LocalCorrectionBlock, LocalWriting, PublicationSuggestion, SyncMutation } from "../lib/local-db/schema";

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
    artifact_type: "general",
    visibility: "private",
    version,
    updated_at: "2026-03-17T00:00:00.000Z",
  },
  created_at: version,
  attempts: 0,
});

const createSuggestion = (id: string): PublicationSuggestion => ({
  id,
  kind: "spelling",
  title: "Fix spelling",
  reason: "",
  original_text: "prueva",
  replacement_text: "prueba",
  block_id: "correction-block:blk-a:12",
  source_hash: "blk-a",
  status: "pending",
})

const createCorrectionBlock = (
  id: string,
  writingId: string,
  createdAt: string,
): LocalCorrectionBlock => ({
  id,
  writingId,
  blockId: "correction-block:blk-a:12",
  blockHash: id.split(":").at(-1) ?? id,
  suggestions: [createSuggestion(`suggestion-${id}`)],
  model: "test-model",
  createdAt,
  latencyMs: 120,
  promptTokens: 10,
  completionTokens: 5,
  syncedAt: null,
})

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

  it("reads writings by canonical filesystem path", async () => {
    setLocalDBScope("canonical-path-user");
    await localDB.writings.save({
      ...createWriting("writing-canonical", 1),
      canonical_path: "/Users/test/Artifact Studio/letter.md",
    });

    const writing = await localDB.writings.getByCanonicalPath("/Users/test/Artifact Studio/letter.md");
    expect(writing?.id).toBe("writing-canonical");
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

  it("stores, syncs, and evicts correction blocks by writing", async () => {
    setLocalDBScope("corrections-user");

    await localDB.correctionBlocks.save(
      createCorrectionBlock(
        "auto-correction:writing-a:blk-a",
        "writing-a",
        "2026-05-19T00:00:00.000Z",
      ),
    );
    await localDB.correctionBlocks.save(
      createCorrectionBlock(
        "auto-correction:writing-b:blk-b",
        "writing-b",
        "2026-05-20T00:00:00.000Z",
      ),
    );

    const writingABlocks = await localDB.correctionBlocks.getByWriting("writing-a");
    expect(writingABlocks).toHaveLength(1);
    expect(writingABlocks[0]?.syncedAt).toBeNull();

    await localDB.correctionBlocks.markSynced(
      "auto-correction:writing-a:blk-a",
      "2026-05-21T00:00:00.000Z",
    );
    expect((await localDB.correctionBlocks.getByWriting("writing-a"))[0]?.syncedAt).toBe(
      "2026-05-21T00:00:00.000Z",
    );

    const evictedWritingId = await localDB.correctionBlocks.evictOldestWriting(1);
    expect(evictedWritingId).toBe("writing-a");
    expect(await localDB.correctionBlocks.getByWriting("writing-a")).toEqual([]);
    expect(await localDB.correctionBlocks.getByWriting("writing-b")).toHaveLength(1);
  });

  it("does not rewrite local_updated_at when detaching an already detached file", async () => {
    setLocalDBScope("detach-noop-user");

    await localDB.writings.save({
      ...createWriting("writing-detached", 1),
      canonical_path: null,
      local_updated_at: 1000,
    });

    await localDB.writings.detachLocalFile("writing-detached");

    const writing = await localDB.writings.get("writing-detached");
    expect(writing?.canonical_path).toBeNull();
    expect(writing?.local_updated_at).toBe(1000);
  });

  it("does not throw when correction blocks have undefined createdAt", async () => {
    setLocalDBScope("corrections-undefined-user");

    const blockWithUndefinedCreatedAt = {
      ...createCorrectionBlock(
        "auto-correction:writing-c:blk-c",
        "writing-c",
        "2026-05-21T00:00:00.000Z",
      ),
      createdAt: undefined as unknown as string,
    };
    const blockWithDefinedCreatedAt = createCorrectionBlock(
      "auto-correction:writing-d:blk-d",
      "writing-d",
      "2026-05-22T00:00:00.000Z",
    );

    await expect(
      localDB.correctionBlocks.saveMany([blockWithUndefinedCreatedAt, blockWithDefinedCreatedAt]),
    ).resolves.not.toThrow();
    await expect(localDB.correctionBlocks.getByWriting("writing-c")).resolves.not.toThrow();
    await expect(localDB.correctionBlocks.evictOldestWriting(1)).resolves.not.toThrow();
  });
});
