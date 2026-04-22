export const LOCAL_DB_NAME = "odessay-local-first";
export const LOCAL_DB_VERSION = 5;

export const LOCAL_DB_STORES = {
  writings: "writings",
  collections: "collections",
  writingCollections: "writing-collections",
  syncMutations: "sync-mutations",
} as const;

export type LocalSyncStatus = "synced" | "pending" | "failed" | "deleted";
export type WritingStatus = "draft" | "finished";
export type WritingVisibility = "private" | "shared" | "public";
export type CollectionVisibility = "private" | "public";
export type WritingLifecycle = "local-only" | "syncing" | "server-confirmed";
export type SyncOperation = "upsert" | "delete" | "set";
export type SyncEntityKind = "writing" | "collection" | "writing-collections";

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
  lifecycle: WritingLifecycle;
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

export type LocalCollection = {
  id: string;
  owner_id?: string | null;
  name: string;
  description?: string | null;
  visibility: CollectionVisibility;
  sync_status: LocalSyncStatus;
  lifecycle: WritingLifecycle;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: number;
};

export type RemoteCollectionPayload = {
  owner_id?: string | null;
  name: string;
  description?: string | null;
  visibility: CollectionVisibility;
  updated_at: string;
};

export type LocalWritingCollection = {
  id: string;
  writing_id: string;
  collection_id: string;
  added_at: string;
  local_updated_at: number;
};

export type RemoteWritingCollectionsPayload = {
  collection_ids: string[];
  updated_at: string;
};

type BaseSyncMutation = {
  id: string;
  entity_kind: SyncEntityKind;
  entity_id: string;
  entity_key: string;
  operation: SyncOperation;
  created_at: number;
  attempts: number;
  last_error?: string;
  next_retry_at?: number;
};

export type WritingSyncMutation = BaseSyncMutation & {
  entity_kind: "writing";
  operation: "upsert" | "delete";
  payload: RemoteWritingPayload;
};

export type CollectionSyncMutation = BaseSyncMutation & {
  entity_kind: "collection";
  operation: "upsert" | "delete";
  payload: RemoteCollectionPayload;
};

export type WritingCollectionsSyncMutation = BaseSyncMutation & {
  entity_kind: "writing-collections";
  operation: "set";
  payload: RemoteWritingCollectionsPayload;
};

export type SyncMutation =
  | WritingSyncMutation
  | CollectionSyncMutation
  | WritingCollectionsSyncMutation;

export type WritingListFilters = {
  syncStatus?: LocalSyncStatus;
  includeDeleted?: boolean;
};

export type CollectionListFilters = {
  includeDeleted?: boolean;
  visibility?: CollectionVisibility;
};

export type LocalDBScope = string | null | undefined;
