import {
  LOCAL_DB_NAME,
  LOCAL_DB_STORES,
  LOCAL_DB_VERSION,
  type LocalDBScope,
  type LocalWriting,
  type SyncMutation,
  type WritingListFilters,
} from "@/lib/local-db/schema";
import { filterWritings, sortWritings } from "@/lib/local-db/writings";

type LocalDB = {
  writings: {
    save: (writing: LocalWriting) => Promise<void>;
    get: (id: string) => Promise<LocalWriting | null>;
    getAll: (filters?: WritingListFilters) => Promise<LocalWriting[]>;
    delete: (id: string) => Promise<void>;
  };
  syncQueue: {
    enqueue: (mutation: SyncMutation) => Promise<void>;
    getPending: () => Promise<SyncMutation[]>;
    getCurrentForWriting: (writingId: string) => Promise<SyncMutation | null>;
    markSynced: (id: string) => Promise<void>;
    markFailed: (id: string, error: string, nextRetryAt: number) => Promise<void>;
  };
};

const DEFAULT_SCOPE = "anonymous";

const assertBrowser = () => {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("localDB is only available in the browser.");
  }
};

let dbPromise: Promise<IDBDatabase> | null = null;
let databaseInstance: IDBDatabase | null = null;
let currentScope = DEFAULT_SCOPE;

const normalizeScope = (scope?: LocalDBScope) => {
  const value = scope?.trim();
  return value ? value.replace(/[^a-zA-Z0-9-_]/g, "_") : DEFAULT_SCOPE;
};

const getDatabaseName = () => `${LOCAL_DB_NAME}-${currentScope}`;

const resetDatabaseHandle = () => {
  if (databaseInstance) {
    databaseInstance.close();
    databaseInstance = null;
  }

  dbPromise = null;
};

export const setLocalDBScope = (scope?: LocalDBScope) => {
  const nextScope = normalizeScope(scope);

  if (nextScope === currentScope) {
    return;
  }

  currentScope = nextScope;
  resetDatabaseHandle();
};

export const getLocalDBScope = () => currentScope;

const openDatabase = () => {
  assertBrowser();

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(getDatabaseName(), LOCAL_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.writings)) {
        database.createObjectStore(LOCAL_DB_STORES.writings, {
          keyPath: "id",
        });
      }

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.syncMutations)) {
        const syncStore = database.createObjectStore(LOCAL_DB_STORES.syncMutations, {
          keyPath: "id",
        });
        syncStore.createIndex("by-created-at", "created_at", { unique: false });
        syncStore.createIndex("by-writing-id", "writing_id", { unique: true });
      } else {
        const transaction = request.transaction;

        if (transaction) {
          const syncStore = transaction.objectStore(LOCAL_DB_STORES.syncMutations);

          if (!syncStore.indexNames.contains("by-writing-id")) {
            syncStore.createIndex("by-writing-id", "writing_id", { unique: true });
          }
        }
      }
    };

    request.onsuccess = () => {
      databaseInstance = request.result;
      databaseInstance.onversionchange = () => {
        resetDatabaseHandle();
      };
      resolve(request.result);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open IndexedDB for localDB."));
  });

  return dbPromise;
};

const runRequest = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });

const withStore = async <T>(
  storeName: (typeof LOCAL_DB_STORES)[keyof typeof LOCAL_DB_STORES],
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
) => {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);

  const result = await handler(store);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(`IndexedDB transaction failed for ${storeName}.`));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`IndexedDB transaction aborted for ${storeName}.`));
  });

  return result;
};

const saveWriting = async (writing: LocalWriting) => {
  await withStore(LOCAL_DB_STORES.writings, "readwrite", async (store) => {
    await runRequest(store.put(writing));
  });
};

const getWriting = async (id: string) =>
  withStore(LOCAL_DB_STORES.writings, "readonly", async (store) => {
    const writing = await runRequest(store.get(id));
    return (writing as LocalWriting | undefined) ?? null;
  });

const getAllWritings = async (filters?: WritingListFilters) =>
  withStore(LOCAL_DB_STORES.writings, "readonly", async (store) => {
    const writings = (await runRequest(store.getAll())) as LocalWriting[];
    return sortWritings(filterWritings(writings, filters));
  });

const softDeleteWriting = async (id: string) => {
  const existing = await getWriting(id);

  if (!existing) {
    return;
  }

  await saveWriting({
    ...existing,
    deleted_at: new Date().toISOString(),
    local_updated_at: Date.now(),
    sync_status: "deleted",
    version: existing.version + 1,
    updated_at: new Date().toISOString(),
  });
};

const enqueueMutation = async (mutation: SyncMutation) => {
  await withStore(LOCAL_DB_STORES.syncMutations, "readwrite", async (store) => {
    const existingKey = await runRequest(store.index("by-writing-id").getKey(mutation.writing_id));

    if (existingKey) {
      await runRequest(store.delete(existingKey));
    }

    await runRequest(store.put(mutation));
  });
};

const getPendingMutations = async () =>
  withStore(LOCAL_DB_STORES.syncMutations, "readonly", async (store) => {
    const mutations = (await runRequest(store.getAll())) as SyncMutation[];
    const now = Date.now();

    return mutations
      .filter((mutation) => (mutation.next_retry_at ?? 0) <= now)
      .sort((left, right) => left.created_at - right.created_at);
  });

const getCurrentMutationForWriting = async (writingId: string) =>
  withStore(LOCAL_DB_STORES.syncMutations, "readonly", async (store) => {
    const mutation = await runRequest(store.index("by-writing-id").get(writingId));
    return (mutation as SyncMutation | undefined) ?? null;
  });

const markMutationSynced = async (id: string) => {
  const database = await openDatabase();
  const transaction = database.transaction(
    [LOCAL_DB_STORES.syncMutations, LOCAL_DB_STORES.writings],
    "readwrite",
  );
  const mutationStore = transaction.objectStore(LOCAL_DB_STORES.syncMutations);
  const writingStore = transaction.objectStore(LOCAL_DB_STORES.writings);
  const mutation = (await runRequest(mutationStore.get(id))) as SyncMutation | undefined;

  if (!mutation) {
    transaction.commit?.();
    return;
  }

  await runRequest(mutationStore.delete(id));

  const remainingMutation = (await runRequest(
    mutationStore.index("by-writing-id").get(mutation.writing_id),
  )) as SyncMutation | undefined;

  if (!remainingMutation) {
    const writing = (await runRequest(writingStore.get(mutation.writing_id))) as
      | LocalWriting
      | undefined;

    if (writing && writing.sync_status !== "deleted") {
      await runRequest(
        writingStore.put({
          ...writing,
          sync_status: "synced",
        } satisfies LocalWriting),
      );
    }
  }

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to mark sync mutation as synced."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Synced mutation transaction aborted."));
  });
};

const markMutationFailed = async (id: string, error: string, nextRetryAt: number) => {
  const database = await openDatabase();
  const transaction = database.transaction(
    [LOCAL_DB_STORES.syncMutations, LOCAL_DB_STORES.writings],
    "readwrite",
  );
  const mutationStore = transaction.objectStore(LOCAL_DB_STORES.syncMutations);
  const writingStore = transaction.objectStore(LOCAL_DB_STORES.writings);
  const mutation = (await runRequest(mutationStore.get(id))) as SyncMutation | undefined;

  if (!mutation) {
    transaction.commit?.();
    return;
  }

  const updatedMutation: SyncMutation = {
    ...mutation,
    attempts: mutation.attempts + 1,
    last_error: error,
    next_retry_at: nextRetryAt,
  };

  await runRequest(mutationStore.put(updatedMutation));

  const localWriting = (await runRequest(writingStore.get(mutation.writing_id))) as
    | LocalWriting
    | undefined;

  if (localWriting && localWriting.sync_status !== "deleted") {
    await runRequest(
      writingStore.put({
        ...localWriting,
        sync_status: "failed",
      } satisfies LocalWriting),
    );
  }

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Unable to persist failed sync mutation."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Failed sync mutation transaction aborted."));
  });
};

const localDBInstance: LocalDB = {
  writings: {
    save: saveWriting,
    get: getWriting,
    getAll: getAllWritings,
    delete: softDeleteWriting,
  },
  syncQueue: {
    enqueue: enqueueMutation,
    getPending: getPendingMutations,
    getCurrentForWriting: getCurrentMutationForWriting,
    markSynced: markMutationSynced,
    markFailed: markMutationFailed,
  },
};

export type { LocalDB };
export const localDB = localDBInstance;
