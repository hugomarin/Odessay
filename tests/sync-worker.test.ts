import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEntityKey, type LocalDB } from "../lib/local-db";
import type { LocalWriting, RemoteCollectionPayload, SyncMutation } from "../lib/local-db/schema";
import { getRetryDelayMs } from "../lib/sync/retry";
import type { RemoteWritingRecord } from "../lib/sync/remote-bootstrap";
import { setSyncMetricSink, type SyncFlushMetric } from "../lib/observability/sync-metrics";
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
  lifecycle: "local-only",
  created_at: "2026-03-17T00:00:00.000Z",
  updated_at: "2026-03-17T00:00:00.000Z",
  local_updated_at: 1,
});

const createMutation = (
  overrides: Partial<Extract<SyncMutation, { entity_kind: "writing" }>> = {},
): Extract<SyncMutation, { entity_kind: "writing" }> => ({
  id: "mutation-1",
  entity_kind: "writing",
  entity_id: "writing-1",
  entity_key: createEntityKey("writing", "writing-1"),
  operation: "upsert",
  payload: {
    body_json: {
      type: "doc",
    },
    body_text: "Draft 1",
    status: "draft",
    artifact_type: "general",
    visibility: "private",
    version: 1,
    updated_at: "2026-03-17T00:00:00.000Z",
  },
  created_at: 1,
  attempts: 0,
  ...overrides,
});

const createCollectionDeleteMutation = (
  overrides: Partial<Extract<SyncMutation, { entity_kind: "collection" }>> = {},
): Extract<SyncMutation, { entity_kind: "collection" }> => ({
  id: "mutation-collection-1",
  entity_kind: "collection",
  entity_id: "collection-1",
  entity_key: createEntityKey("collection", "collection-1"),
  operation: "delete",
  payload: {
    owner_id: "user-1",
    name: "Principal",
    description: null,
    visibility: "private",
    updated_at: "2026-03-17T00:00:00.000Z",
  },
  created_at: 1,
  attempts: 0,
  ...overrides,
});

const createRemoteWriting = (overrides: Partial<RemoteWritingRecord> = {}): RemoteWritingRecord => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Draft 1",
  body_json: {
    type: "doc",
  },
  body_text: "Draft 1",
  slug: "draft-1",
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  deleted_at: null,
  created_at: "2026-03-17T00:00:00.000Z",
  updated_at: "2026-03-17T00:00:00.000Z",
  ...overrides,
});

const createLocalDbMock = () => {
  const writing = createWriting();

  return {
    writings: {
      save: vi.fn(async (_nextWriting: LocalWriting) => undefined),
      get: vi.fn(async () => writing),
      getByCanonicalPath: vi.fn(async () => null),
      getByContentHash: vi.fn(async () => []),
      getAll: vi.fn(async () => [writing]),
      detachLocalFile: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      saveWithRebind: vi.fn(async () => undefined),
      transitionLifecycle: vi.fn(
        async (_id: string, transition: { when: (current: LocalWriting["lifecycle"]) => boolean }) => ({
          previous: writing.lifecycle,
          changed: transition.when(writing.lifecycle),
          localUpdatedAt: writing.local_updated_at ?? null,
        }),
      ),
      update: vi.fn(async (_id: string, updater: (current: LocalWriting | null) => LocalWriting | null) =>
        updater(writing),
      ),
    },
    collections: {
      save: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      getAll: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
    },
    correctionBlocks: {
      save: vi.fn(async () => undefined),
      saveMany: vi.fn(async () => undefined),
      getByWriting: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => undefined),
      markSynced: vi.fn(async () => undefined),
      evictOldestWriting: vi.fn(async () => null),
    },
    writingCollections: {
      replaceForWriting: vi.fn(async () => undefined),
      listForWriting: vi.fn(async () => []),
      listAll: vi.fn(async () => []),
      removeCollection: vi.fn(async () => undefined),
    },
    syncQueue: {
      enqueue: vi.fn(async () => undefined),
      getPending: vi.fn(async () => [createMutation()]),
      getCurrentForEntity: vi.fn(async () => createMutation()),
      getCurrentForWriting: vi.fn(async () => createMutation()),
      deleteForEntity: vi.fn(async () => undefined),
      markSynced: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    },
    editorSessions: {
      save: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
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
  setSyncMetricSink(null);
});

describe("SyncWorker", () => {
  it("skips superseded mutations before sending them", async () => {
    const localDb = createLocalDbMock();
    localDb.syncQueue.getPending = vi.fn(async () => [createMutation()]);
    localDb.syncQueue.getCurrentForEntity = vi.fn(async () =>
      createMutation({
        id: "mutation-2",
        payload: { ...createMutation().payload, version: 2 },
      }),
    );

    const upsertWriting = vi.fn(async () => createRemoteWriting());
    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      transport: {
        upsertWriting,
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
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
    localDb.syncQueue.getCurrentForEntity = vi.fn(async () => mutation);

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
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    await worker.flush();

    expect(localDb.syncQueue.markFailed).toHaveBeenCalledWith(
      mutation.id,
      "network",
      now + getRetryDelayMs(1),
    );
  });

  it("coalesces N overlapping triggers into one trailing wakeup", async () => {
    const localDb = createLocalDbMock();
    const upsertMutation = createMutation();
    const deleteMutation = createMutation({
      id: "mutation-2",
      operation: "delete",
      payload: { ...upsertMutation.payload, version: 2, deleted_at: "2026-03-17T00:00:01.000Z" },
    });
    const pendingSnapshots = [[upsertMutation], [deleteMutation]];
    localDb.syncQueue.getPending = vi.fn(async () => pendingSnapshots.shift() ?? []);
    const currentMutations: SyncMutation[] = [upsertMutation, deleteMutation];
    localDb.syncQueue.getCurrentForEntity = vi.fn(
      async () => currentMutations.shift() ?? deleteMutation,
    ) as unknown as typeof localDb.syncQueue.getCurrentForEntity;

    let resolveUpsert!: (writing: RemoteWritingRecord) => void;
    const heldUpsert = new Promise<RemoteWritingRecord>((resolve) => {
      resolveUpsert = resolve;
    });
    const upsertWriting = vi.fn(() => heldUpsert);
    const deleteWriting = vi.fn(async () => undefined);
    const metrics: SyncFlushMetric[] = [];
    setSyncMetricSink((metric) => {
      if (metric.type === "sync.flush") metrics.push(metric);
    });
    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      transport: {
        upsertWriting,
        deleteWriting,
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    const activeFlush = worker.flush();
    await vi.waitFor(() => expect(upsertWriting).toHaveBeenCalledTimes(1));
    await Promise.all(Array.from({ length: 8 }, () => worker.flush()));

    resolveUpsert(createRemoteWriting());
    await activeFlush;
    await vi.waitFor(() => expect(deleteWriting).toHaveBeenCalledTimes(1));

    expect(localDb.syncQueue.getPending).toHaveBeenCalledTimes(2);
    expect(deleteWriting).toHaveBeenCalledTimes(1);
    expect(metrics.filter((metric) => metric.overlapDetected)).toHaveLength(8);
    expect(metrics.filter((metric) => metric.trigger === "pending_wakeup")).toHaveLength(1);
    expect(metrics.find((metric) => metric.trigger === "pending_wakeup")).toMatchObject({
      examined: 1,
      sent: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("keeps retry backoff after an overlap instead of hot-looping the failed mutation", async () => {
    const localDb = createLocalDbMock();
    const mutation = createMutation();
    let nextRetryAt: number | null = null;
    let failedAt: number | null = null;
    localDb.syncQueue.getPending = vi.fn(async () =>
      nextRetryAt === null || nextRetryAt <= Date.now() ? [mutation] : [],
    );
    localDb.syncQueue.getCurrentForEntity = vi.fn(async () => mutation);
    localDb.syncQueue.markFailed = vi.fn(async (_id: string, _message: string, retryAt: number) => {
      nextRetryAt = retryAt;
      failedAt = Date.now();
    });

    vi.useFakeTimers();
    const now = 10_000;
    vi.setSystemTime(now);
    let retryTimer: (() => void) | null = null;
    const scheduleTimeout = vi.fn((callback: () => void, _delay: number) => {
      retryTimer = callback;
      return 1;
    });
    let rejectUpsert!: (error: Error) => void;
    const failedUpsert = new Promise<RemoteWritingRecord>((_resolve, reject) => {
      rejectUpsert = reject;
    });
    const upsertWriting = vi.fn(async () => createRemoteWriting());
    upsertWriting.mockImplementationOnce(() => failedUpsert);
    const metrics: SyncFlushMetric[] = [];
    setSyncMetricSink((metric) => {
      if (metric.type === "sync.flush") metrics.push(metric);
    });
    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      scheduleTimeout,
      clearScheduledTimeout: vi.fn(),
      logError: vi.fn(),
      transport: {
        upsertWriting,
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    const activeFlush = worker.flush();
    await vi.waitFor(() => expect(upsertWriting).toHaveBeenCalledTimes(1));
    await worker.flush();
    rejectUpsert(new Error("network"));
    await activeFlush;
    await vi.waitFor(() =>
      expect(metrics.filter((metric) => metric.trigger === "pending_wakeup")).toHaveLength(1),
    );

    const pendingWakeup = metrics.find((metric) => metric.trigger === "pending_wakeup");
    expect(pendingWakeup).toMatchObject({ examined: 0, sent: 0, succeeded: 0, failed: 0 });
    expect(nextRetryAt).toBe(failedAt! + getRetryDelayMs(1));
    expect(nextRetryAt).toBeGreaterThan(Date.now());
    expect(scheduleTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
    expect(localDb.syncQueue.getPending).toHaveBeenCalledTimes(2);
    expect(upsertWriting).toHaveBeenCalledTimes(1);

    // El ticker conserva su trigger y solo reintenta cuando la mutación ya
    // salió de next_retry_at; el wakeup inmediato no consume ese intento.
    vi.setSystemTime(nextRetryAt!);
    retryTimer!();
    await vi.waitFor(() => expect(upsertWriting).toHaveBeenCalledTimes(2));
    expect(metrics.find((metric) => metric.trigger === "debounce" && !metric.overlapDetected)).toMatchObject({
      examined: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("stop clears a wakeup queued by an in-flight request", async () => {
    const localDb = createLocalDbMock();
    const mutation = createMutation();
    localDb.syncQueue.getPending = vi.fn(async () => [mutation]);
    localDb.syncQueue.getCurrentForEntity = vi.fn(async () => mutation);

    let resolveUpsert!: (writing: RemoteWritingRecord) => void;
    const heldUpsert = new Promise<RemoteWritingRecord>((resolve) => {
      resolveUpsert = resolve;
    });
    const upsertWriting = vi.fn(() => heldUpsert);
    const clearScheduledTimeout = vi.fn();
    const removeOnlineListener = vi.fn();
    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      scheduleTimeout: vi.fn(() => 1),
      clearScheduledTimeout,
      addOnlineListener: vi.fn(),
      removeOnlineListener,
      transport: {
        upsertWriting,
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    worker.start();
    const activeFlush = worker.flush();
    await vi.waitFor(() => expect(upsertWriting).toHaveBeenCalledTimes(1));
    await worker.flush();
    worker.stop();
    resolveUpsert(createRemoteWriting());
    await activeFlush;

    expect(clearScheduledTimeout).toHaveBeenCalledWith(1);
    expect(removeOnlineListener).toHaveBeenCalledTimes(1);
    expect(localDb.syncQueue.getPending).toHaveBeenCalledTimes(1);
    expect(upsertWriting).toHaveBeenCalledTimes(1);
  });

  it("a scheduled flush that fails logs the error instead of leaving an unhandled rejection", async () => {
    // ODE-583 follow-up: the timer-driven flush was fired with `void`, so a
    // local-DB failure inside it (IndexedDB unavailable, or torn down under a
    // test) surfaced as an unhandled rejection. The mutations stay queued and
    // the next flush retries them; the failure only needs to be visible.
    const localDb = createLocalDbMock();
    localDb.syncQueue.getPending = vi.fn(async () => {
      throw new Error("indexeddb unavailable");
    });
    const logError = vi.fn();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let fire: (() => void) | null = null;
    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      logError,
      scheduleTimeout: (callback) => {
        fire = callback;
        return 1;
      },
      clearScheduledTimeout: () => undefined,
      transport: {
        upsertWriting: vi.fn(async () => createRemoteWriting()),
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    try {
      worker.schedule(0);
      expect(fire, "control positivo: el flush quedó agendado").not.toBeNull();
      fire!();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled, "sin rechazo sin manejar").not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith(
        "[sync:flush]",
        expect.objectContaining({ error: "indexeddb unavailable" }),
      );
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("retries pending mutations after connectivity is restored", async () => {
    const localDb = createLocalDbMock();
    const mutation = createMutation();
    localDb.syncQueue.getPending = vi.fn(async () => [mutation]);
    localDb.syncQueue.getCurrentForEntity = vi.fn(async () => mutation);

    let isOnline = false;
    const upsertWriting = vi.fn(async () => createRemoteWriting());
    const worker = new SyncWorker({
      localDb,
      isOnline: () => isOnline,
      transport: {
        upsertWriting,
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    await worker.flush();
    expect(upsertWriting).not.toHaveBeenCalled();

    isOnline = true;
    await worker.flush();

    expect(upsertWriting).toHaveBeenCalledTimes(1);
    expect(localDb.syncQueue.markSynced).toHaveBeenCalledWith(mutation.id);
    // La fila remota se aplica con una actualización atómica contra la fila
    // actual (ODE-583), no con un `save` a ciegas.
    expect(localDb.writings.update).toHaveBeenCalledTimes(1);
    await expect(localDb.writings.update.mock.results[0]?.value).resolves.toEqual(
      expect.objectContaining({
        slug: "draft-1",
      }),
    );
  });

  it("deja la cola synced cuando el segundo DELETE de una colección no borra nada", async () => {
    // Idempotencia de ODE-660: el primer DELETE borra la fila (deleted:true) y
    // el segundo —la repetición de una respuesta perdida, o una colección
    // creada y borrada offline— responde deleted:false. Los dos son éxito para
    // la cola: si el segundo se tratara como error, el worker reintentaría
    // hasta 10 veces antes de marcarla fallida terminal.
    const localDb = createLocalDbMock();
    const first = createCollectionDeleteMutation();
    const second = createCollectionDeleteMutation({
      id: "mutation-collection-2",
      created_at: 2,
    });
    let current: SyncMutation = first;
    localDb.syncQueue.getPending = vi.fn(async () => [current]) as unknown as typeof localDb.syncQueue.getPending;
    localDb.syncQueue.getCurrentForEntity = vi.fn(async () => current) as unknown as typeof localDb.syncQueue.getCurrentForEntity;

    const responses = [
      { id: first.entity_id, deleted: true },
      { id: second.entity_id, deleted: false },
    ];
    const deleteCollection = vi.fn(
      async (collectionId: string, _payload: RemoteCollectionPayload): Promise<void> => {
        // El handler real responde 200 con `{ id, deleted }` en las dos
        // llamadas; la segunda (deleted:false) es el caso de ODE-660. El
        // transporte del worker no consume el cuerpo, así que el doble modela
        // la respuesta del endpoint sin alterar el resultado.
        const response = responses.shift();
        if (!response || response.id !== collectionId) {
          throw new Error(`DELETE inesperado: ${collectionId}`);
        }
      },
    );

    const worker = new SyncWorker({
      localDb,
      isOnline: () => true,
      transport: {
        upsertWriting: vi.fn(async () => createRemoteWriting()),
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection,
        setWritingCollections: vi.fn(async () => undefined),
      },
    });

    await worker.flush();
    expect(deleteCollection).toHaveBeenCalledTimes(1);
    expect(deleteCollection).toHaveBeenLastCalledWith(first.entity_id, first.payload);
    expect(localDb.syncQueue.markSynced).toHaveBeenCalledWith(first.id);

    current = second;
    await worker.flush();
    expect(deleteCollection).toHaveBeenCalledTimes(2);
    expect(deleteCollection).toHaveBeenLastCalledWith(second.entity_id, second.payload);
    expect(localDb.syncQueue.markSynced).toHaveBeenCalledWith(second.id);
    expect(localDb.syncQueue.markFailed, "deleted:false no es un fallo").not.toHaveBeenCalled();
  });
});
