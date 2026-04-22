/**
 * ODE-61 — Visibility transitions
 *
 * Covers:
 *   - sync queue payload includes the visibility field for every transition
 *   - local store reflects the correct visibility after each transition
 *   - remote bootstrap normalises unknown/null visibility values to 'private'
 *   - remote bootstrap propagates 'shared' and 'public' from the server
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { localDB, setLocalDBScope } from "../lib/local-db";
import type { LocalWriting } from "../lib/local-db/schema";
import { mapRemoteWritingToLocal, shouldApplyRemoteWriting, type RemoteWritingRecord } from "../lib/sync/remote-bootstrap";
import { enqueueWritingUpsert } from "../lib/sync/queue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "test-writing-1",
  author_id: "user-1",
  title: "My writing",
  body_json: { type: "doc", content: [] },
  body_text: "Hello",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-03-31T00:00:00.000Z",
  updated_at: "2026-03-31T00:00:00.000Z",
  local_updated_at: 1743379200000,
  ...overrides,
});

const makeRemote = (overrides: Partial<RemoteWritingRecord> = {}): RemoteWritingRecord => ({
  id: "test-writing-1",
  author_id: "user-1",
  title: "My writing",
  body_json: { type: "doc", content: [] },
  body_text: "Hello",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  deleted_at: null,
  created_at: "2026-03-31T00:00:00.000Z",
  updated_at: "2026-03-31T00:00:00.000Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Scope isolation
// ---------------------------------------------------------------------------

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = globalThis;
  setLocalDBScope(`test-${crypto.randomUUID()}`);
});

// ---------------------------------------------------------------------------
// 1. Local-store persistence across visibility transitions
// ---------------------------------------------------------------------------

describe("local store — visibility field", () => {
  it("stores private writing correctly", async () => {
    const writing = makeWriting({ visibility: "private" });
    await localDB.writings.save(writing);
    const stored = await localDB.writings.get(writing.id);
    expect(stored?.visibility).toBe("private");
  });

  it("stores shared writing correctly", async () => {
    const writing = makeWriting({ visibility: "shared" });
    await localDB.writings.save(writing);
    const stored = await localDB.writings.get(writing.id);
    expect(stored?.visibility).toBe("shared");
  });

  it("stores public writing correctly", async () => {
    const writing = makeWriting({ visibility: "public" });
    await localDB.writings.save(writing);
    const stored = await localDB.writings.get(writing.id);
    expect(stored?.visibility).toBe("public");
  });

  it("reflects visibility change from private → shared in local store", async () => {
    const initial = makeWriting({ visibility: "private" });
    await localDB.writings.save(initial);

    const updated = makeWriting({ visibility: "shared", version: 2, sync_status: "pending" });
    await localDB.writings.save(updated);

    const stored = await localDB.writings.get(initial.id);
    expect(stored?.visibility).toBe("shared");
  });

  it("reflects visibility change from shared → public in local store", async () => {
    const initial = makeWriting({ visibility: "shared" });
    await localDB.writings.save(initial);

    const updated = makeWriting({ visibility: "public", version: 2, sync_status: "pending" });
    await localDB.writings.save(updated);

    const stored = await localDB.writings.get(initial.id);
    expect(stored?.visibility).toBe("public");
  });

  it("reflects visibility change from public → private in local store", async () => {
    const initial = makeWriting({ visibility: "public" });
    await localDB.writings.save(initial);

    const updated = makeWriting({ visibility: "private", version: 2, sync_status: "pending" });
    await localDB.writings.save(updated);

    const stored = await localDB.writings.get(initial.id);
    expect(stored?.visibility).toBe("private");
  });
});

// ---------------------------------------------------------------------------
// 2. Sync queue — visibility flows into the remote payload
// ---------------------------------------------------------------------------

describe("sync queue — visibility in remote payload", () => {
  it("enqueues upsert with visibility=private", async () => {
    const writing = makeWriting({ visibility: "private", sync_status: "synced" });
    await enqueueWritingUpsert(writing);
    const mutation = await localDB.syncQueue.getCurrentForWriting(writing.id);
    expect(mutation && mutation.entity_kind === "writing" ? mutation.payload.visibility : null).toBe("private");
  });

  it("enqueues upsert with visibility=shared", async () => {
    const writing = makeWriting({ visibility: "shared", sync_status: "synced" });
    await enqueueWritingUpsert(writing);
    const mutation = await localDB.syncQueue.getCurrentForWriting(writing.id);
    expect(mutation && mutation.entity_kind === "writing" ? mutation.payload.visibility : null).toBe("shared");
  });

  it("enqueues upsert with visibility=public", async () => {
    const writing = makeWriting({ visibility: "public", sync_status: "synced" });
    await enqueueWritingUpsert(writing);
    const mutation = await localDB.syncQueue.getCurrentForWriting(writing.id);
    expect(mutation && mutation.entity_kind === "writing" ? mutation.payload.visibility : null).toBe("public");
  });
});

// ---------------------------------------------------------------------------
// 3. Remote bootstrap — visibility normalisation
// ---------------------------------------------------------------------------

describe("remote bootstrap — visibility normalisation", () => {
  it("normalises null visibility to private", () => {
    const local = mapRemoteWritingToLocal(makeRemote({ visibility: null }));
    expect(local.visibility).toBe("private");
  });

  it("normalises unknown string to private", () => {
    const local = mapRemoteWritingToLocal(
      // force a bad value to simulate schema drift or legacy data
      makeRemote({ visibility: "draft" as "private" }),
    );
    expect(local.visibility).toBe("private");
  });

  it("preserves shared visibility from remote", () => {
    const local = mapRemoteWritingToLocal(makeRemote({ visibility: "shared" }));
    expect(local.visibility).toBe("shared");
  });

  it("preserves public visibility from remote", () => {
    const local = mapRemoteWritingToLocal(makeRemote({ visibility: "public" }));
    expect(local.visibility).toBe("public");
  });
});

// ---------------------------------------------------------------------------
// 4. Remote bootstrap merge — respects sync_status gate on visibility update
// ---------------------------------------------------------------------------

describe("remote bootstrap merge — sync gate on visibility", () => {
  it("does not overwrite pending local write with remote visibility change", () => {
    const local = makeWriting({ visibility: "private", sync_status: "pending", version: 2 });
    const remote = makeRemote({ visibility: "public", version: 3 });
    // Remote has higher version but local is pending — must NOT override.
    expect(shouldApplyRemoteWriting(local, remote)).toBe(false);
  });

  it("applies remote visibility update when local is synced and remote is newer", () => {
    const local = makeWriting({ visibility: "private", sync_status: "synced", version: 1 });
    const remote = makeRemote({
      visibility: "public",
      slug: "my-writing",
      version: 2,
      updated_at: "2026-03-31T01:00:00.000Z",
    });
    expect(shouldApplyRemoteWriting(local, remote)).toBe(true);
    const merged = mapRemoteWritingToLocal(remote);
    expect(merged.visibility).toBe("public");
    expect(merged.slug).toBe("my-writing");
  });

  it("propagates server-assigned slug back into local store via bootstrap", () => {
    const remote = makeRemote({
      visibility: "public",
      slug: "my-writing",
      version: 2,
      updated_at: "2026-03-31T01:00:00.000Z",
    });
    const local = mapRemoteWritingToLocal(remote);
    expect(local.slug).toBe("my-writing");
  });
});
