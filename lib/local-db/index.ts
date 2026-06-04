import {
  LOCAL_DB_NAME,
  LOCAL_DB_STORES,
  LOCAL_DB_VERSION,
  type CollectionListFilters,
  type LocalCorrectionBlock,
  type LocalEditorSession,
  type LocalCollection,
  type LocalDBScope,
  type LocalSyncStatus,
  type LocalWriting,
  type LocalWritingCollection,
  type SyncEntityKind,
  type SyncMutation,
  type WritingLifecycle,
  type WritingListFilters,
} from "@/lib/local-db/schema";
import { normalizeWritingStatus } from "@/lib/writings/status";
import { filterWritings, sortWritings } from "@/lib/local-db/writings";

type LocalDB = {
  writings: {
    save: (writing: LocalWriting) => Promise<void>;
    get: (id: string) => Promise<LocalWriting | null>;
    getByCanonicalPath: (canonicalPath: string) => Promise<LocalWriting | null>;
    getAll: (filters?: WritingListFilters) => Promise<LocalWriting[]>;
    delete: (id: string) => Promise<void>;
  };
  collections: {
    save: (collection: LocalCollection) => Promise<void>;
    get: (id: string) => Promise<LocalCollection | null>;
    getAll: (filters?: CollectionListFilters) => Promise<LocalCollection[]>;
    delete: (id: string) => Promise<void>;
  };
  correctionBlocks: {
    save: (block: LocalCorrectionBlock) => Promise<void>;
    saveMany: (blocks: LocalCorrectionBlock[]) => Promise<void>;
    getByWriting: (writingId: string) => Promise<LocalCorrectionBlock[]>;
    delete: (id: string) => Promise<void>;
    deleteMany: (ids: string[]) => Promise<void>;
    markSynced: (id: string, syncedAt: string) => Promise<void>;
    evictOldestWriting: (maxWritings: number) => Promise<string | null>;
  };
  writingCollections: {
    replaceForWriting: (writingId: string, collectionIds: string[]) => Promise<void>;
    listForWriting: (writingId: string) => Promise<LocalWritingCollection[]>;
    listAll: () => Promise<LocalWritingCollection[]>;
    removeCollection: (collectionId: string) => Promise<void>;
  };
  syncQueue: {
    enqueue: (mutation: SyncMutation) => Promise<void>;
    getPending: () => Promise<SyncMutation[]>;
    getCurrentForEntity: (
      entityKind: SyncEntityKind,
      entityId: string,
    ) => Promise<SyncMutation | null>;
    getCurrentForWriting: (writingId: string) => Promise<SyncMutation | null>;
    markSynced: (id: string) => Promise<void>;
    markFailed: (id: string, error: string, nextRetryAt: number) => Promise<void>;
  };
  editorSessions: {
    save: (session: LocalEditorSession) => Promise<void>;
    get: (id: string) => Promise<LocalEditorSession | null>;
  };
};

const DEFAULT_SCOPE = "anonymous";
type LocalDBScopeListener = (scope: string) => void;
type LocalDBChangeListener = () => void;

const assertBrowser = () => {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("localDB is only available in the browser.");
  }
};

let dbPromise: Promise<IDBDatabase> | null = null;
let databaseInstance: IDBDatabase | null = null;
let currentScope = DEFAULT_SCOPE;
const scopeListeners = new Set<LocalDBScopeListener>();
const changeListeners = new Set<LocalDBChangeListener>();

const normalizeScope = (scope?: LocalDBScope) => {
  const value = scope?.trim();
  return value ? value.replace(/[^a-zA-Z0-9-_]/g, "_") : DEFAULT_SCOPE;
};

const getDatabaseName = () => `${LOCAL_DB_NAME}-${currentScope}`;

const createEntityKey = (entityKind: SyncEntityKind, entityId: string) =>
  `${entityKind}:${entityId}`;

const createWritingCollectionId = (writingId: string, collectionId: string) =>
  `${writingId}:${collectionId}`;

const getEntityStoreName = (entityKind: SyncEntityKind) => {
  if (entityKind === "writing") {
    return LOCAL_DB_STORES.writings;
  }

  if (entityKind === "collection") {
    return LOCAL_DB_STORES.collections;
  }

  if (entityKind === "writing-collections") {
    return LOCAL_DB_STORES.writings;
  }

  return null;
};

const filterCollections = (
  collections: LocalCollection[],
  filters: CollectionListFilters = {},
) =>
  collections
    .filter((collection) => {
      if (!filters.includeDeleted && collection.sync_status === "deleted") {
        return false;
      }

      if (filters.visibility && collection.visibility !== filters.visibility) {
        return false;
      }

      return true;
    })
    .sort((left, right) => right.local_updated_at - left.local_updated_at);

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
  dbPromise = null;

  if (databaseInstance) {
    const oldInstance = databaseInstance;
    databaseInstance = null;
    // Defer close so in-flight transactions on the old instance can complete.
    // IndexedDB transactions auto-commit at the end of the current task;
    // scheduling close for the next macrotask avoids aborting active work.
    setTimeout(() => {
      oldInstance.close();
    }, 0);
  }

  scopeListeners.forEach((listener) => listener(nextScope));
};

export const getLocalDBScope = () => currentScope;

export const subscribeToLocalDBScopeChanges = (listener: LocalDBScopeListener) => {
  scopeListeners.add(listener);

  return () => {
    scopeListeners.delete(listener);
  };
};

const emitLocalDBChange = () => {
  changeListeners.forEach((listener) => listener());
};

export const subscribeToLocalDBChanges = (listener: LocalDBChangeListener) => {
  changeListeners.add(listener);

  return () => {
    changeListeners.delete(listener);
  };
};

const openDatabase = () => {
  assertBrowser();

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(getDatabaseName(), LOCAL_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const oldVersion = event.oldVersion;

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.writings)) {
        const writingStore = database.createObjectStore(LOCAL_DB_STORES.writings, {
          keyPath: "id",
        });
        writingStore.createIndex("by-canonical-path", "canonical_path", { unique: false });
      } else {
        const transaction = request.transaction;

        if (transaction) {
          const store = transaction.objectStore(LOCAL_DB_STORES.writings);

          if (!store.indexNames.contains("by-canonical-path")) {
            store.createIndex("by-canonical-path", "canonical_path", { unique: false });
          }
        }
      }

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.collections)) {
        database.createObjectStore(LOCAL_DB_STORES.collections, {
          keyPath: "id",
        });
      }

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.writingCollections)) {
        const store = database.createObjectStore(LOCAL_DB_STORES.writingCollections, {
          keyPath: "id",
        });
        store.createIndex("by-writing-id", "writing_id", { unique: false });
        store.createIndex("by-collection-id", "collection_id", { unique: false });
      } else {
        const transaction = request.transaction;

        if (transaction) {
          const store = transaction.objectStore(LOCAL_DB_STORES.writingCollections);

          if (!store.indexNames.contains("by-writing-id")) {
            store.createIndex("by-writing-id", "writing_id", { unique: false });
          }

          if (!store.indexNames.contains("by-collection-id")) {
            store.createIndex("by-collection-id", "collection_id", { unique: false });
          }
        }
      }

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.syncMutations)) {
        const syncStore = database.createObjectStore(LOCAL_DB_STORES.syncMutations, {
          keyPath: "id",
        });
        syncStore.createIndex("by-created-at", "created_at", { unique: false });
        syncStore.createIndex("by-entity-key", "entity_key", { unique: true });
      } else {
        const transaction = request.transaction;

        if (transaction) {
          const syncStore = transaction.objectStore(LOCAL_DB_STORES.syncMutations);

          if (syncStore.indexNames.contains("by-writing-id")) {
            syncStore.deleteIndex("by-writing-id");
          }

          if (!syncStore.indexNames.contains("by-entity-key")) {
            syncStore.createIndex("by-entity-key", "entity_key", { unique: true });
          }
        }
      }

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.editorSessions)) {
        database.createObjectStore(LOCAL_DB_STORES.editorSessions, {
          keyPath: "id",
        });
      }

      if (!database.objectStoreNames.contains(LOCAL_DB_STORES.correctionBlocks)) {
        const correctionStore = database.createObjectStore(LOCAL_DB_STORES.correctionBlocks, {
          keyPath: "id",
        });
        correctionStore.createIndex("by-writing-id", "writingId", { unique: false });
        correctionStore.createIndex("by-created-at", "createdAt", { unique: false });
      } else {
        const transaction = request.transaction;

        if (transaction) {
          const correctionStore = transaction.objectStore(LOCAL_DB_STORES.correctionBlocks);

          if (!correctionStore.indexNames.contains("by-writing-id")) {
            correctionStore.createIndex("by-writing-id", "writingId", { unique: false });
          }

          if (!correctionStore.indexNames.contains("by-created-at")) {
            correctionStore.createIndex("by-created-at", "createdAt", { unique: false });
          }
        }
      }

      if (oldVersion < 3 && database.objectStoreNames.contains(LOCAL_DB_STORES.writings)) {
        const transaction = request.transaction;

        if (transaction) {
          const store = transaction.objectStore(LOCAL_DB_STORES.writings);
          const cursor = store.openCursor();

          cursor.onsuccess = () => {
            const result = cursor.result;

            if (!result) {
              if (!store.indexNames.contains("by-entity-key")) {
                store.createIndex("by-entity-key", "entity_key", { unique: true });
              }
              return;
            }

            const writing = result.value as LocalWriting & { lifecycle?: WritingLifecycle };

            if (!writing.lifecycle) {
              const lifecycle: WritingLifecycle =
                writing.sync_status === "synced" || writing.sync_status === "deleted"
                  ? "server-confirmed"
                  : "local-only";

              result.update({ ...writing, lifecycle });
            }

            result.continue();
          };
        }
      }

      if (oldVersion > 0 && oldVersion < 4 && database.objectStoreNames.contains(LOCAL_DB_STORES.syncMutations)) {
        const transaction = request.transaction;

        if (transaction) {
          const store = transaction.objectStore(LOCAL_DB_STORES.syncMutations);
          const cursor = store.openCursor();

          cursor.onsuccess = () => {
            const result = cursor.result;

            if (!result) {
              return;
            }

            const mutation = result.value as
              | (SyncMutation & { writing_id?: string })
              | {
                  id: string;
                  writing_id?: string;
                  operation: SyncMutation["operation"];
                  payload: SyncMutation["payload"];
                  created_at: number;
                  attempts: number;
                  last_error?: string;
                  next_retry_at?: number;
                };

            if (!("entity_kind" in mutation) || !mutation.entity_kind) {
              const entityId = mutation.writing_id ?? "";
              result.update({
                ...mutation,
                entity_kind: "writing",
                entity_id: entityId,
                entity_key: createEntityKey("writing", entityId),
              });
            }

            result.continue();
          };
        }
      }

      if (oldVersion > 0 && oldVersion < 9) {
        const transaction = request.transaction;

        if (transaction && database.objectStoreNames.contains(LOCAL_DB_STORES.writings)) {
          const store = transaction.objectStore(LOCAL_DB_STORES.writings);
          const cursor = store.openCursor();

          cursor.onsuccess = () => {
            const result = cursor.result;

            if (!result) {
              return;
            }

            const writing = result.value as LocalWriting;
            const nextStatus = normalizeWritingStatus(writing.status);

            if (writing.status !== nextStatus) {
              result.update({
                ...writing,
                status: nextStatus,
              });
            }

            result.continue();
          };
        }

        if (transaction && database.objectStoreNames.contains(LOCAL_DB_STORES.syncMutations)) {
          const store = transaction.objectStore(LOCAL_DB_STORES.syncMutations);
          const cursor = store.openCursor();

          cursor.onsuccess = () => {
            const result = cursor.result;

            if (!result) {
              return;
            }

            const mutation = result.value as SyncMutation;

            if (mutation.entity_kind === "writing") {
              const nextStatus = normalizeWritingStatus(mutation.payload.status);

              if (mutation.payload.status !== nextStatus) {
                result.update({
                  ...mutation,
                  payload: {
                    ...mutation.payload,
                    status: nextStatus,
                  },
                });
              }
            }

            result.continue();
          };
        }
      }

      if (oldVersion > 0 && oldVersion < 12 && database.objectStoreNames.contains(LOCAL_DB_STORES.writings)) {
        const transaction = request.transaction;

        if (transaction) {
          const store = transaction.objectStore(LOCAL_DB_STORES.writings);

          if (!store.indexNames.contains("by-canonical-path")) {
            store.createIndex("by-canonical-path", "canonical_path", { unique: false });
          }
        }
      }

      if (oldVersion > 0 && oldVersion < 10 && database.objectStoreNames.contains("publication-reviews")) {
        database.deleteObjectStore("publication-reviews");
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

const waitForTransaction = (
  transaction: IDBTransaction,
  message: string,
) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(`${message} transaction failed.`));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${message} transaction aborted.`));
  });

const withStore = async <T>(
  storeName: (typeof LOCAL_DB_STORES)[keyof typeof LOCAL_DB_STORES],
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
) => {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const completion = waitForTransaction(
    transaction,
    `IndexedDB transaction for ${storeName}`,
  );

  const result = await handler(store);
  await completion;

  return result;
};

const saveWriting = async (writing: LocalWriting) => {
  await withStore(LOCAL_DB_STORES.writings, "readwrite", async (store) => {
    await runRequest(store.put(writing));
  });
  emitLocalDBChange();
};

const getWriting = async (id: string) =>
  withStore(LOCAL_DB_STORES.writings, "readonly", async (store) => {
    const writing = await runRequest(store.get(id));
    return (writing as LocalWriting | undefined) ?? null;
  });

const getWritingByCanonicalPath = async (canonicalPath: string) =>
  withStore(LOCAL_DB_STORES.writings, "readonly", async (store) => {
    const writing = await runRequest(store.index("by-canonical-path").get(canonicalPath));
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

const saveCollection = async (collection: LocalCollection) => {
  await withStore(LOCAL_DB_STORES.collections, "readwrite", async (store) => {
    await runRequest(store.put(collection));
  });
  emitLocalDBChange();
};

const saveCorrectionBlock = async (block: LocalCorrectionBlock) => {
  await withStore(LOCAL_DB_STORES.correctionBlocks, "readwrite", async (store) => {
    await runRequest(store.put(block));
  });
  emitLocalDBChange();
};

const saveCorrectionBlocks = async (blocks: LocalCorrectionBlock[]) => {
  if (blocks.length === 0) {
    return;
  }

  await withStore(LOCAL_DB_STORES.correctionBlocks, "readwrite", async (store) => {
    await Promise.all(blocks.map((block) => runRequest(store.put(block))));
  });
  emitLocalDBChange();
};

const saveEditorSession = async (session: LocalEditorSession) => {
  await withStore(LOCAL_DB_STORES.editorSessions, "readwrite", async (store) => {
    await runRequest(store.put(session));
  });
  emitLocalDBChange();
};

const getEditorSession = async (id: string) =>
  withStore(LOCAL_DB_STORES.editorSessions, "readonly", async (store) => {
    const session = await runRequest(store.get(id));
    return (session as LocalEditorSession | undefined) ?? null;
  });

const getCorrectionBlocksByWriting = async (writingId: string) =>
  withStore(LOCAL_DB_STORES.correctionBlocks, "readonly", async (store) => {
    const blocks = (await runRequest(
      store.index("by-writing-id").getAll(IDBKeyRange.only(writingId)),
    )) as LocalCorrectionBlock[];

    return blocks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  });

const deleteCorrectionBlock = async (id: string) => {
  await withStore(LOCAL_DB_STORES.correctionBlocks, "readwrite", async (store) => {
    await runRequest(store.delete(id));
  });
  emitLocalDBChange();
};

const deleteCorrectionBlocks = async (ids: string[]) => {
  if (ids.length === 0) {
    return;
  }

  await withStore(LOCAL_DB_STORES.correctionBlocks, "readwrite", async (store) => {
    await Promise.all(ids.map((id) => runRequest(store.delete(id))));
  });
  emitLocalDBChange();
};

const markCorrectionBlockSynced = async (id: string, syncedAt: string) => {
  await withStore(LOCAL_DB_STORES.correctionBlocks, "readwrite", async (store) => {
    const block = (await runRequest(store.get(id))) as LocalCorrectionBlock | undefined;

    if (!block) {
      return;
    }

    await runRequest(
      store.put({
        ...block,
        syncedAt,
      } satisfies LocalCorrectionBlock),
    );
  });
  emitLocalDBChange();
};

const evictOldestCorrectionWriting = async (maxWritings: number) => {
  if (maxWritings < 1) {
    return null;
  }

  const blocks = await withStore(LOCAL_DB_STORES.correctionBlocks, "readonly", async (store) =>
    (await runRequest(store.getAll())) as LocalCorrectionBlock[],
  );
  const writingMeta = new Map<string, { oldestCreatedAt: string; blockIds: string[] }>();

  for (const block of blocks) {
    const existing = writingMeta.get(block.writingId);

    if (!existing) {
      writingMeta.set(block.writingId, {
        oldestCreatedAt: block.createdAt,
        blockIds: [block.id],
      });
      continue;
    }

    existing.oldestCreatedAt =
      existing.oldestCreatedAt.localeCompare(block.createdAt) <= 0
        ? existing.oldestCreatedAt
        : block.createdAt;
    existing.blockIds.push(block.id);
  }

  if (writingMeta.size <= maxWritings) {
    return null;
  }

  const oldestWriting = [...writingMeta.entries()].sort((left, right) =>
    left[1].oldestCreatedAt.localeCompare(right[1].oldestCreatedAt),
  )[0];

  if (!oldestWriting) {
    return null;
  }

  await deleteCorrectionBlocks(oldestWriting[1].blockIds);
  return oldestWriting[0];
};

const getCollection = async (id: string) =>
  withStore(LOCAL_DB_STORES.collections, "readonly", async (store) => {
    const collection = await runRequest(store.get(id));
    return (collection as LocalCollection | undefined) ?? null;
  });

const getAllCollections = async (filters?: CollectionListFilters) =>
  withStore(LOCAL_DB_STORES.collections, "readonly", async (store) => {
    const collections = (await runRequest(store.getAll())) as LocalCollection[];
    return filterCollections(collections, filters);
  });

const softDeleteCollection = async (id: string) => {
  const existing = await getCollection(id);

  if (!existing) {
    return;
  }

  await saveCollection({
    ...existing,
    deleted_at: new Date().toISOString(),
    local_updated_at: Date.now(),
    sync_status: "deleted",
    updated_at: new Date().toISOString(),
  });

  await removeCollectionAssignments(id);
};

const listWritingCollectionsForWriting = async (writingId: string) =>
  withStore(LOCAL_DB_STORES.writingCollections, "readonly", async (store) => {
    const rows = (await runRequest(
      store.index("by-writing-id").getAll(IDBKeyRange.only(writingId)),
    )) as LocalWritingCollection[];

    return rows.sort((left, right) => left.added_at.localeCompare(right.added_at));
  });

const listAllWritingCollections = async () =>
  withStore(LOCAL_DB_STORES.writingCollections, "readonly", async (store) => {
    const rows = (await runRequest(store.getAll())) as LocalWritingCollection[];
    return rows.sort((left, right) => right.local_updated_at - left.local_updated_at);
  });

const replaceWritingCollections = async (writingId: string, collectionIds: string[]) => {
  const database = await openDatabase();
  const transaction = database.transaction(LOCAL_DB_STORES.writingCollections, "readwrite");
  const store = transaction.objectStore(LOCAL_DB_STORES.writingCollections);
  const index = store.index("by-writing-id");
  const completion = waitForTransaction(transaction, "Writing collection replacement");
  const existingRows = (await runRequest(
    index.getAll(IDBKeyRange.only(writingId)),
  )) as LocalWritingCollection[];
  const existingRowsById = new Map(existingRows.map((row) => [row.id, row]));
  const now = Date.now();
  const addedAt = new Date().toISOString();
  const requests: IDBRequest[] = [];

  for (const row of existingRows) {
    requests.push(store.delete(row.id));
  }

  for (const collectionId of collectionIds) {
    const id = createWritingCollectionId(writingId, collectionId);
    const existingRow = existingRowsById.get(id);

    requests.push(
      store.put({
        id,
        writing_id: writingId,
        collection_id: collectionId,
        added_at: existingRow?.added_at ?? addedAt,
        local_updated_at: existingRow?.local_updated_at ?? now,
      } satisfies LocalWritingCollection),
    );
  }

  await Promise.all(requests.map((request) => runRequest(request)));
  await completion;
  emitLocalDBChange();
};

const removeCollectionAssignments = async (collectionId: string) => {
  const database = await openDatabase();
  const transaction = database.transaction(LOCAL_DB_STORES.writingCollections, "readwrite");
  const store = transaction.objectStore(LOCAL_DB_STORES.writingCollections);
  const completion = waitForTransaction(transaction, "Collection assignment removal");
  const rows = (await runRequest(
    store.index("by-collection-id").getAll(IDBKeyRange.only(collectionId)),
  )) as LocalWritingCollection[];
  const requests: IDBRequest[] = [];

  for (const row of rows) {
    requests.push(store.delete(row.id));
  }

  await Promise.all(requests.map((request) => runRequest(request)));
  await completion;
  emitLocalDBChange();
};

const enqueueMutation = async (mutation: SyncMutation) => {
  await withStore(LOCAL_DB_STORES.syncMutations, "readwrite", async (store) => {
    const entityKey =
      mutation.entity_key ?? createEntityKey(mutation.entity_kind, mutation.entity_id);
    const existingKey = await runRequest(store.index("by-entity-key").getKey(entityKey));
    const requests: IDBRequest[] = [];

    if (existingKey) {
      requests.push(store.delete(existingKey));
    }

    requests.push(
      store.put({
        ...mutation,
        entity_key: entityKey,
      } satisfies SyncMutation),
    );

    await Promise.all(requests.map((request) => runRequest(request)));
  });
  emitLocalDBChange();
};

const getPendingMutations = async () =>
  withStore(LOCAL_DB_STORES.syncMutations, "readonly", async (store) => {
    const mutations = (await runRequest(store.getAll())) as SyncMutation[];
    const now = Date.now();

    return mutations
      .filter((mutation) => (mutation.next_retry_at ?? 0) <= now)
      .sort((left, right) => left.created_at - right.created_at);
  });

const getCurrentMutationForEntity = async (
  entityKind: SyncEntityKind,
  entityId: string,
) =>
  withStore(LOCAL_DB_STORES.syncMutations, "readonly", async (store) => {
    const mutation = await runRequest(
      store.index("by-entity-key").get(createEntityKey(entityKind, entityId)),
    );
    return (mutation as SyncMutation | undefined) ?? null;
  });

const setEntitySyncState = async (
  entityKind: SyncEntityKind,
  entityId: string,
  syncStatus: LocalSyncStatus,
  lifecycle?: WritingLifecycle,
) => {
  if (entityKind === "writing") {
    const writing = await getWriting(entityId);

    if (!writing || writing.sync_status === "deleted") {
      return;
    }

    await saveWriting({
      ...writing,
      sync_status: syncStatus,
      lifecycle: lifecycle ?? writing.lifecycle,
    });
    return;
  }

  if (entityKind === "collection") {
    const collection = await getCollection(entityId);

    if (!collection || collection.sync_status === "deleted") {
      return;
    }

    await saveCollection({
      ...collection,
      sync_status: syncStatus,
      lifecycle: lifecycle ?? collection.lifecycle,
    });
    return;
  }

  if (entityKind === "writing-collections") {
    const writing = await getWriting(entityId);

    if (!writing || writing.sync_status === "deleted") {
      return;
    }

    await saveWriting({
      ...writing,
      sync_status: syncStatus,
      lifecycle: lifecycle ?? writing.lifecycle,
    });
  }
};

const markMutationSynced = async (id: string) => {
  const database = await openDatabase();
  const initialTransaction = database.transaction(LOCAL_DB_STORES.syncMutations, "readonly");
  const initialStore = initialTransaction.objectStore(LOCAL_DB_STORES.syncMutations);
  const initialMutation = (await runRequest(initialStore.get(id))) as SyncMutation | undefined;
  await waitForTransaction(initialTransaction, "Load synced mutation");

  if (!initialMutation) {
    return;
  }

  const entityStoreName = getEntityStoreName(initialMutation.entity_kind);
  const storeNames = entityStoreName
    ? [LOCAL_DB_STORES.syncMutations, entityStoreName]
    : [LOCAL_DB_STORES.syncMutations];
  const transaction = database.transaction(storeNames, "readwrite");
  const mutationStore = transaction.objectStore(LOCAL_DB_STORES.syncMutations);
  const completion = waitForTransaction(transaction, "Synced mutation");
  const mutation = (await runRequest(mutationStore.get(id))) as SyncMutation | undefined;

  if (!mutation) {
    transaction.commit?.();
    return;
  }

  await runRequest(mutationStore.delete(id));

  const remainingMutation = (await runRequest(
    mutationStore.index("by-entity-key").get(mutation.entity_key),
  )) as SyncMutation | undefined;

  if (!remainingMutation && entityStoreName) {
    const entityStore = transaction.objectStore(entityStoreName);
    const entity = await runRequest(entityStore.get(mutation.entity_id));

    if (entityStoreName === LOCAL_DB_STORES.collections) {
      const collection = entity as LocalCollection | undefined;

      if (collection && collection.sync_status !== "deleted") {
        entityStore.put({
          ...collection,
          sync_status: "synced",
          lifecycle: "server-confirmed",
        } satisfies LocalCollection);
      }
    } else {
      const writing = entity as LocalWriting | undefined;

      if (writing && writing.sync_status !== "deleted") {
        entityStore.put({
          ...writing,
          sync_status: "synced",
          lifecycle: "server-confirmed",
        } satisfies LocalWriting);
      }
    }
  }

  await completion;
  emitLocalDBChange();
};

const markMutationFailed = async (id: string, error: string, nextRetryAt: number) => {
  const database = await openDatabase();
  const transaction = database.transaction(LOCAL_DB_STORES.syncMutations, "readwrite");
  const mutationStore = transaction.objectStore(LOCAL_DB_STORES.syncMutations);
  const completion = waitForTransaction(transaction, "Failed mutation");
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

  await completion;
  emitLocalDBChange();

  await setEntitySyncState(mutation.entity_kind, mutation.entity_id, "failed");
};

const localDBInstance: LocalDB = {
  writings: {
    save: saveWriting,
    get: getWriting,
    getByCanonicalPath: getWritingByCanonicalPath,
    getAll: getAllWritings,
    delete: softDeleteWriting,
  },
  collections: {
    save: saveCollection,
    get: getCollection,
    getAll: getAllCollections,
    delete: softDeleteCollection,
  },
  correctionBlocks: {
    save: saveCorrectionBlock,
    saveMany: saveCorrectionBlocks,
    getByWriting: getCorrectionBlocksByWriting,
    delete: deleteCorrectionBlock,
    deleteMany: deleteCorrectionBlocks,
    markSynced: markCorrectionBlockSynced,
    evictOldestWriting: evictOldestCorrectionWriting,
  },
  writingCollections: {
    replaceForWriting: replaceWritingCollections,
    listForWriting: listWritingCollectionsForWriting,
    listAll: listAllWritingCollections,
    removeCollection: removeCollectionAssignments,
  },
  syncQueue: {
    enqueue: enqueueMutation,
    getPending: getPendingMutations,
    getCurrentForEntity: getCurrentMutationForEntity,
    getCurrentForWriting: (writingId: string) =>
      getCurrentMutationForEntity("writing", writingId),
    markSynced: markMutationSynced,
    markFailed: markMutationFailed,
  },
  editorSessions: {
    save: saveEditorSession,
    get: getEditorSession,
  },
};

export type { LocalDB };
export { createEntityKey, createWritingCollectionId };
export const localDB = localDBInstance;
