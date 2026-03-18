import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDB } from "../lib/local-db";
import type { LocalWriting, SyncMutation } from "../lib/local-db/schema";
import { getRetryDelayMs } from "../lib/sync/retry";
import { SyncWorker } from "../lib/sync/worker";

const createWriting = (): LocalWriting => ({
  id: "writing-1",
  body_json: {
    type: "doc",
  },
  body_text: "Draft 1",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: "pending",
  created_at: "2026-03-17T00:00:00.000Z",
  updated_at: "2026-03-17T00:00:00.000Z",
  local_updated_at: 1,
});

const createMutation = (overrides: Partial<SyncMutation> = {}): SyncMutation => ({
  id: "mutation-1",
  writing_id: "writing-1",
  operation: "upsert",
  payload: {
    body_json: {
      type: "doc",
    },
    body_text: "Draft 1",
    status: "draft",
    visibility: "private",
    version: 1,
    updated_at: "2026-03-17T00:00:00.000Z",
  },
  created_at: 1,
  attempts: 0,
  ...overrides,
});

const createLocalDbMock = () => {
  const writing = createWriting();

  return {
    writings: {
      save: vi.fn(async (_nextWriting: LocalWriting) => undefined),
      get: vi.fn(async () => writing),
      getAll: vi.fn(async () => [writing]),
      delete: vi.fn(async () => undefined),
    },
    syncQueue: {
      enqueue: vi.fn(async () => undefined),
      getPending: vi.fn(async () => [createMutation()]),
      getCurrentForWriting: vi.fn(async () => createMutation()),
      markSynced: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    },
  } satisfies LocalDB;
};

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncWorker", () => {
  it("skips superseded mutations before sending them", async () => {
    const localDb = createLocalDbMock();
    localDb.syncQueue.getPending = vi.fn(async () => [createMutation()]);
    localDb.syncQueue.getCurrentForWriting = vi.fn(async () =>
      createMutation({ id: "mutation-2", payload: { ...createMutation().payload, version: 2 } }),
    );

    const upsertWriting = vi.fn(async () => undefined);
    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      transport: {
        upsertWriting,
        deleteWriting: vi.fn(async () => undefined),
      },
    });

    await worker.flush();

    expect(upsertWriting).not.toHaveBeenCalled();
    expect(localDb.syncQueue.markSynced).not.toHaveBeenCalled();
  });

  it("marks failed mutations with exponential backoff", async () => {
    const localDb = createLocalDbMock();
    const mutation = createMutation();
    localDb.syncQueue.getPending = vi.fn(async () => [mutation]);
    localDb.syncQueue.getCurrentForWriting = vi.fn(async () => mutation);

    const now = 1000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      transport: {
        upsertWriting: vi.fn(async () => {
          throw new Error("network");
        }),
        deleteWriting: vi.fn(async () => undefined),
      },
    });

    await worker.flush();

    expect(localDb.syncQueue.markFailed).toHaveBeenCalledWith(
      mutation.id,
      "network",
      now + getRetryDelayMs(1),
    );
  });

  it("retries pending mutations after connectivity is restored", async () => {
    const localDb = createLocalDbMock();
    const mutation = createMutation();
    localDb.syncQueue.getPending = vi.fn(async () => [mutation]);
    localDb.syncQueue.getCurrentForWriting = vi.fn(async () => mutation);

    let isOnline = false;
    const upsertWriting = vi.fn(async () => undefined);
    const worker = new SyncWorker({
      localDb,
      isOnline: () => isOnline,
      transport: {
        upsertWriting,
        deleteWriting: vi.fn(async () => undefined),
      },
    });

    await worker.flush();
    expect(upsertWriting).not.toHaveBeenCalled();

    isOnline = true;
    await worker.flush();

    expect(upsertWriting).toHaveBeenCalledTimes(1);
    expect(localDb.syncQueue.markSynced).toHaveBeenCalledWith(mutation.id);
  });
});
