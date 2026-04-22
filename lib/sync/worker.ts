import { localDB, type LocalDB } from "@/lib/local-db";
import type { SyncMutation } from "@/lib/local-db/schema";
import { emitSyncStatusChange } from "@/lib/sync/events";
import { canRetryMutation, getNextRetryAt } from "@/lib/sync/retry";
import { mapRemoteWritingToLocal, type RemoteWritingRecord } from "@/lib/sync/remote-bootstrap";

type SyncTransport = {
  upsertWriting: (
    writingId: string,
    payload: Extract<SyncMutation, { entity_kind: "writing" }>["payload"],
  ) => Promise<RemoteWritingRecord | null>;
  deleteWriting: (
    writingId: string,
    payload: Extract<SyncMutation, { entity_kind: "writing" }>["payload"],
  ) => Promise<void>;
  upsertCollection: (
    collectionId: string,
    payload: Extract<SyncMutation, { entity_kind: "collection" }>["payload"],
  ) => Promise<void>;
  deleteCollection: (
    collectionId: string,
    payload: Extract<SyncMutation, { entity_kind: "collection" }>["payload"],
  ) => Promise<void>;
  setWritingCollections: (
    writingId: string,
    payload: Extract<SyncMutation, { entity_kind: "writing-collections" }>["payload"],
  ) => Promise<void>;
};

type SyncEnvelope = {
  data: unknown;
  error: { code: string; message: string } | null;
};

type SyncRemoteError = Error & {
  status?: number;
  code?: string | null;
  url?: string;
};

const parseEnvelope = async <T>(response: Response): Promise<T> => {
  let result: SyncEnvelope | null = null;

  try {
    result = (await response.json()) as SyncEnvelope;
  } catch {
    result = null;
  }

  if (!response.ok || result?.error) {
    const rawMessage = result?.error?.message?.trim();
    const message =
      rawMessage && rawMessage.length > 0
        ? rawMessage
        : `Sync request failed with status ${response.status}.`;
    const error: SyncRemoteError = new Error(message);
    error.status = response.status;
    error.code = result?.error?.code ?? null;
    error.url = response.url;
    throw error;
  }

  return result?.data as T;
};

const defaultTransport: SyncTransport = {
  upsertWriting: async (writingId, payload) => {
    const response = await fetch(`/api/writings/${writingId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return parseEnvelope<RemoteWritingRecord | null>(response);
  },
  deleteWriting: async (writingId, payload) => {
    const response = await fetch(`/api/writings/${writingId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deleted_at: payload.deleted_at,
        updated_at: payload.updated_at,
        version: payload.version,
      }),
    });

    await parseEnvelope(response);
  },
  upsertCollection: async (collectionId, payload) => {
    const response = await fetch(`/api/collections/${collectionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    await parseEnvelope(response);
  },
  deleteCollection: async (collectionId) => {
    const response = await fetch(`/api/collections/${collectionId}`, {
      method: "DELETE",
    });

    await parseEnvelope(response);
  },
  setWritingCollections: async (writingId, payload) => {
    const response = await fetch(`/api/writings/${writingId}/collections`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    await parseEnvelope(response);
  },
};

type SyncWorkerOptions = {
  transport?: SyncTransport;
  localDb?: LocalDB;
  isOnline?: () => boolean;
  scheduleTimeout?: (callback: () => void, delay: number) => number;
  clearScheduledTimeout?: (timeoutId: number) => void;
  addOnlineListener?: (callback: () => void) => void;
  removeOnlineListener?: (callback: () => void) => void;
  logError?: (message: string, context: Record<string, unknown>) => void;
};

class SyncWorker {
  private readonly debounceMs = 1500;
  private readonly transport: SyncTransport;
  private readonly localDb: LocalDB;
  private readonly isOnline: () => boolean;
  private readonly scheduleTimeout: (callback: () => void, delay: number) => number;
  private readonly clearScheduledTimeout: (timeoutId: number) => void;
  private readonly addOnlineListener: (callback: () => void) => void;
  private readonly removeOnlineListener: (callback: () => void) => void;
  private readonly logError: (message: string, context: Record<string, unknown>) => void;
  private timeoutId: number | null = null;
  private isRunning = false;
  private started = false;

  constructor(options: SyncWorkerOptions = {}) {
    this.transport = options.transport ?? defaultTransport;
    this.localDb = options.localDb ?? localDB;
    this.isOnline =
      options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine);
    this.scheduleTimeout =
      options.scheduleTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
    this.clearScheduledTimeout =
      options.clearScheduledTimeout ?? ((timeoutId) => window.clearTimeout(timeoutId));
    this.addOnlineListener =
      options.addOnlineListener ?? ((callback) => window.addEventListener("online", callback));
    this.removeOnlineListener =
      options.removeOnlineListener ?? ((callback) => window.removeEventListener("online", callback));
    this.logError =
      options.logError ??
      ((message, context) => {
        // Remote sync errors are handled with retry policy; keep diagnostics visible without surfacing a hard runtime error.
        console.warn(`${message} ${JSON.stringify(context)}`);
      });
  }

  start() {
    if (typeof window === "undefined" || this.started) {
      return;
    }

    this.started = true;
    this.addOnlineListener(this.handleOnline);
    this.schedule();
  }

  stop() {
    if (typeof window === "undefined" || !this.started) {
      return;
    }

    this.started = false;

    if (this.timeoutId) {
      this.clearScheduledTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    this.removeOnlineListener(this.handleOnline);
  }

  schedule(delay = this.debounceMs) {
    if (typeof window === "undefined") {
      return;
    }

    if (this.timeoutId) {
      this.clearScheduledTimeout(this.timeoutId);
    }

    this.timeoutId = this.scheduleTimeout(() => {
      this.timeoutId = null;
      void this.flush();
    }, delay);
  }

  async flush() {
    if (typeof window === "undefined" || this.isRunning) {
      return;
    }

    if (!this.isOnline()) {
      const pendingMutations = await this.localDb.syncQueue.getPending();

      pendingMutations.forEach((mutation) => {
        if (mutation.entity_kind === "writing") {
          emitSyncStatusChange({
            writingId: mutation.entity_id,
            status: "offline",
          });
        }
      });

      return;
    }

    this.isRunning = true;

    try {
      const mutations = await this.localDb.syncQueue.getPending();

      for (const mutation of mutations) {
        await this.processMutation(mutation);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private readonly handleOnline = () => {
    this.schedule(0);
  };

  private async processMutation(mutation: SyncMutation) {
    const currentMutation = await this.localDb.syncQueue.getCurrentForEntity(
      mutation.entity_kind,
      mutation.entity_id,
    );

    if (!currentMutation || currentMutation.id !== mutation.id) {
      return;
    }

    try {
      emitSyncStatusChange({
        writingId: mutation.entity_id,
        status: mutation.entity_kind === "writing" ? "syncing" : "pending",
      });

      const localWriting =
        mutation.entity_kind === "writing"
          ? await this.localDb.writings.get(mutation.entity_id)
          : null;

      if (localWriting && localWriting.lifecycle !== "syncing") {
        await this.localDb.writings.save({
          ...localWriting,
          lifecycle: "syncing",
        });
      }

      if (mutation.entity_kind === "writing") {
        if (mutation.operation === "delete") {
          await this.transport.deleteWriting(mutation.entity_id, mutation.payload);
        } else {
          const remoteWriting = await this.transport.upsertWriting(
            mutation.entity_id,
            mutation.payload,
          );

          if (remoteWriting) {
            await this.localDb.writings.save(mapRemoteWritingToLocal(remoteWriting));
          }
        }
      } else if (mutation.entity_kind === "collection") {
        if (mutation.operation === "delete") {
          await this.transport.deleteCollection(mutation.entity_id, mutation.payload);
        } else {
          await this.transport.upsertCollection(mutation.entity_id, mutation.payload);
        }
      } else {
        await this.transport.setWritingCollections(mutation.entity_id, mutation.payload);
      }

      await this.localDb.syncQueue.markSynced(mutation.id);

      if (mutation.entity_kind === "writing") {
        emitSyncStatusChange({
          writingId: mutation.entity_id,
          status: "synced",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      const syncError = error as SyncRemoteError;

      this.logError("[sync:remote]", {
        mutationId: mutation.id,
        writingId: mutation.entity_id,
        entityKind: mutation.entity_kind,
        operation: mutation.operation,
        attempt: mutation.attempts + 1,
        error: message,
        status: typeof syncError?.status === "number" ? syncError.status : undefined,
        code: typeof syncError?.code === "string" ? syncError.code : undefined,
        url: typeof syncError?.url === "string" ? syncError.url : undefined,
      });

      if (mutation.entity_kind === "writing") {
        emitSyncStatusChange({
          writingId: mutation.entity_id,
          status: "retrying",
        });
      }

      if (!canRetryMutation(mutation.attempts + 1)) {
        await this.localDb.syncQueue.markFailed(mutation.id, message, Number.MAX_SAFE_INTEGER);
        return;
      }

      await this.localDb.syncQueue.markFailed(
        mutation.id,
        message,
        getNextRetryAt(mutation.attempts + 1),
      );
      this.schedule();
    }
  }
}

let syncWorkerSingleton: SyncWorker | null = null;

export const getSyncWorker = () => {
  if (!syncWorkerSingleton) {
    syncWorkerSingleton = new SyncWorker();
  }

  return syncWorkerSingleton;
};

export { SyncWorker };
