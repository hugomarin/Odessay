import type { ArtifactType } from "@/lib/writings/artifact-type";
import type { WritingStatus } from "@/lib/writings/status";

export const LOCAL_DB_NAME = "odessay-local-first";
export const LOCAL_DB_VERSION = 14;

export const LOCAL_DB_STORES = {
  writings: "writings",
  collections: "collections",
  writingCollections: "writing-collections",
  syncMutations: "sync-mutations",
  editorSessions: "editor-sessions",
  correctionBlocks: "correction-blocks",
} as const;

export type LocalSyncStatus = "synced" | "pending" | "failed" | "deleted";
export type { WritingStatus } from "@/lib/writings/status";
export type { ArtifactType } from "@/lib/writings/artifact-type";
export type WritingVisibility = "private" | "shared" | "public";
export type CollectionVisibility = "private" | "public";
export type WritingLifecycle = "local-only" | "syncing" | "server-confirmed";
export type SyncOperation = "upsert" | "delete" | "set";
export type SyncEntityKind = "writing" | "collection" | "writing-collections";

export type LocalWriting = {
  id: string;
  author_id?: string | null;
  title?: string | null;
  canonical_path?: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  content_hash?: string | null;
  slug?: string | null;
  status: WritingStatus;
  artifact_type?: ArtifactType | null;
  visibility: WritingVisibility;
  parent_id?: string | null;
  correspondence_id?: string | null;
  version: number;
  sync_status: LocalSyncStatus;
  lifecycle: WritingLifecycle;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  content_updated_at?: string | null;
  metadata_updated_at?: string | null;
  local_updated_at: number;
};

export type RemoteWritingPayload = {
  author_id?: string | null;
  title?: string | null;
  body_json: Record<string, unknown>;
  body_text: string;
  content_hash?: string | null;
  slug?: string | null;
  status: WritingStatus;
  artifact_type: ArtifactType;
  visibility: WritingVisibility;
  parent_id?: string | null;
  correspondence_id?: string | null;
  version: number;
  updated_at: string;
  deleted_at?: string | null;
  content_updated_at?: string | null;
  metadata_updated_at?: string | null;
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

export type EditorTabSaveState = "saved" | "saving" | "saved-local" | "error";
export type EditorTabMode = "rich" | "markdown";

export type LocalEditorTabViewState = {
  mode: EditorTabMode;
  scrollTop: number;
  scrollLeft: number;
  selectionFrom: number | null;
  selectionTo: number | null;
  markdownSelectionStart: number | null;
  markdownSelectionEnd: number | null;
  windowScrollX?: number;
  windowScrollY?: number;
  shellScrollTop?: number;
  shellScrollLeft?: number;
};

export type LocalEditorSessionTab = {
  id: string;
  writing_id: string | null;
  slug?: string | null;
  title: string;
  save_state: EditorTabSaveState;
  has_pending_sync: boolean;
  last_touched_at: number;
  view_state?: LocalEditorTabViewState | null;
};

export type LocalEditorRecentWriting = {
  writing_id: string;
  slug?: string | null;
  title: string;
  last_touched_at: number;
};

export type LocalEditorSession = {
  id: string;
  active_tab_id: string | null;
  tabs: LocalEditorSessionTab[];
  recent_writings: LocalEditorRecentWriting[];
  updated_at: number;
};

export type PublicationSuggestionKind = "spelling" | "grammar" | "punctuation" | "rewriting";
export type PublicationSuggestionStatus = "pending" | "pending-stale" | "accepted" | "rejected" | "conflict";
export type PublicationChecklistStatus = "pending" | "done";

export type PublicationSuggestion = {
  id: string;
  kind: PublicationSuggestionKind;
  title: string;
  reason: string;
  original_text: string;
  replacement_text: string;
  context_before?: string | null;
  context_after?: string | null;
  occurrence?: number | null;
  block_id?: string | null;
  source_hash?: string | null;
  correction_fingerprint?: string | null;
  status: PublicationSuggestionStatus;
};

export type PublicationChecklistItem = {
  id: string;
  label: string;
  detail: string;
  target_text?: string | null;
  status: PublicationChecklistStatus;
};

export type LocalPublicationReview = {
  id: string;
  writing_id: string;
  source_hash: string;
  source_markdown: string;
  title: string;
  model: string;
  suggestions: PublicationSuggestion[];
  checklist: PublicationChecklistItem[];
  summary: string | null;
  created_at: string;
  updated_at: string;
  lookup_key: string;
  last_error: string | null;
};

export type LocalCorrectionBlock = {
  id: string;
  writingId: string;
  blockId: string;
  blockHash: string;
  suggestions: PublicationSuggestion[];
  model: string;
  createdAt: string;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  syncedAt: string | null;
};
