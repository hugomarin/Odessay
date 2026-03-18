export const LOCAL_DB_NAME = "odessay-local-first";
export const LOCAL_DB_VERSION = 2;

export const LOCAL_DB_STORES = {
  writings: "writings",
  syncMutations: "sync-mutations",
} as const;

export type LocalSyncStatus = "synced" | "pending" | "failed" | "deleted";
export type WritingStatus = "draft" | "finished";
export type WritingVisibility = "private" | "shared" | "public";
export type SyncOperation = "upsert" | "delete";

export type LocalWriting = {
  id: string;
  author_id?: string | null;
  title?: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  slug?: string | null;
  status: WritingStatus;
  visibility: WritingVisibility;
  parent_id?: string | null;
  correspondence_id?: string | null;
  version: number;
  sync_status: LocalSyncStatus;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: number;
};

export type RemoteWritingPayload = {
  author_id?: string | null;
  title?: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  slug?: string | null;
  status: WritingStatus;
  visibility: WritingVisibility;
  parent_id?: string | null;
  correspondence_id?: string | null;
  version: number;
  updated_at: string;
  deleted_at?: string | null;
};

export type SyncMutation = {
  id: string;
  writing_id: string;
  operation: SyncOperation;
  payload: RemoteWritingPayload;
  created_at: number;
  attempts: number;
  last_error?: string;
  next_retry_at?: number;
};

export type WritingListFilters = {
  syncStatus?: LocalSyncStatus;
  includeDeleted?: boolean;
};

export type LocalDBScope = string | null | undefined;
