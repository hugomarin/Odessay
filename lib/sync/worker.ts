import { localDB } from "@/lib/local-db"
import type { SyncMutation } from "@/lib/local-db/schema"
import { canRetryMutation, getNextRetryAt } from "@/lib/sync/retry"
import { createClient } from "@/lib/supabase/client"

type SyncTransport = {
  upsertWriting: (writingId: string, payload: SyncMutation["payload"]) => Promise<void>
  deleteWriting: (writingId: string) => Promise<void>
}

const defaultTransport: SyncTransport = {
  upsertWriting: async (writingId, payload) => {
    const supabase = createClient();
    const { error } = await supabase.from("writings").upsert(
      {
        id: writingId,
        ...payload,
      },
      { onConflict: "id" },
    )

    if (error) {
      throw error
    }
  },
  deleteWriting: async (writingId) => {
    const supabase = createClient()
    const { error } = await supabase
      .from("writings")
      .update({
        deleted_at: new Date().toISOString(),
      })
      .eq("id", writingId)

    if (error) {
      throw error
    }
  },
}

class SyncWorker {
  private readonly debounceMs = 1500;
  private readonly transport: SyncTransport;
  private timeoutId: number | null = null;
  private isRunning = false;
  private started = false;

  constructor(transport: SyncTransport = defaultTransport) {
    this.transport = transport;
  }

  start() {
    if (typeof window === "undefined" || this.started) {
      return;
    }

    this.started = true;
    window.addEventListener("online", this.handleOnline);
    this.schedule();
  }

  stop() {
    if (typeof window === "undefined" || !this.started) {
      return;
    }

    this.started = false;

    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    window.removeEventListener("online", this.handleOnline);
  }

  schedule(delay = this.debounceMs) {
    if (typeof window === "undefined") {
      return;
    }

    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }

    this.timeoutId = window.setTimeout(() => {
      this.timeoutId = null;
      void this.flush();
    }, delay);
  }

  async flush() {
    if (typeof window === "undefined" || this.isRunning) {
      return;
    }

    if (!navigator.onLine) {
      return;
    }

    this.isRunning = true;

    try {
      const mutations = await localDB.syncQueue.getPending();

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
    try {
      if (mutation.operation === "delete") {
        await this.transport.deleteWriting(mutation.writing_id);
      } else {
        await this.transport.upsertWriting(mutation.writing_id, mutation.payload);
      }

      await localDB.syncQueue.markSynced(mutation.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";

      console.error("[sync:remote]", {
        writingId: mutation.writing_id,
        operation: mutation.operation,
        attempt: mutation.attempts + 1,
        error: message,
      });

      if (!canRetryMutation(mutation.attempts + 1)) {
        await localDB.syncQueue.markFailed(mutation.id, message, Number.MAX_SAFE_INTEGER);
        return;
      }

      await localDB.syncQueue.markFailed(
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
