import { localDB, type LocalDB } from "@/lib/local-db";
import type { SyncMutation } from "@/lib/local-db/schema";
import { canRetryMutation, getNextRetryAt } from "@/lib/sync/retry";

type SyncTransport = {
  upsertWriting: (writingId: string, payload: SyncMutation["payload"]) => Promise<void>;
  deleteWriting: (writingId: string, payload: SyncMutation["payload"]) => Promise<void>;
};

const parseEnvelope = async (response: Response) => {
  const result = (await response.json()) as {
    data: unknown;
    error: { code: string; message: string } | null;
  };

  if (!response.ok || result.error) {
    throw new Error(result.error?.message ?? `Sync request failed with status ${response.status}.`);
  }
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

    await parseEnvelope(response);
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
    this.logError = options.logError ?? ((message, context) => console.error(message, context));
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
    const currentMutation = await this.localDb.syncQueue.getCurrentForWriting(mutation.writing_id);

    if (!currentMutation || currentMutation.id !== mutation.id) {
      return;
    }

    try {
      if (mutation.operation === "delete") {
        await this.transport.deleteWriting(mutation.writing_id, mutation.payload);
      } else {
        await this.transport.upsertWriting(mutation.writing_id, mutation.payload);
      }

      await this.localDb.syncQueue.markSynced(mutation.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";

      this.logError("[sync:remote]", {
        writingId: mutation.writing_id,
        operation: mutation.operation,
        attempt: mutation.attempts + 1,
        error: message,
      });

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
