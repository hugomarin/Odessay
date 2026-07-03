import type {
  EditorTabSaveState,
  EditorTabMode,
  LocalEditorRecentWriting,
  LocalEditorSession,
  LocalEditorSessionTab,
  LocalEditorTabViewState,
} from "@/lib/local-db/schema";

export const EDITOR_SESSION_RECORD_ID = "workspace";
export const EDITOR_DRAFT_TAB_ID = "draft";
export const EDITOR_MAX_RECENTS = 8;
export const EDITOR_SOFT_TAB_LIMIT = 10;

export type EditorSessionTabInput = {
  id: string;
  writingId: string | null;
  slug?: string | null;
  title?: string | null;
  saveState?: EditorTabSaveState;
  hasPendingSync?: boolean;
  lastTouchedAt?: number;
  viewState?: Partial<LocalEditorTabViewState> | null;
};

const DEFAULT_VIEW_STATE: LocalEditorTabViewState = {
  mode: "rich",
  scrollTop: 0,
  scrollLeft: 0,
  selectionFrom: null,
  selectionTo: null,
  markdownSelectionStart: null,
  markdownSelectionEnd: null,
  windowScrollX: 0,
  windowScrollY: 0,
  shellScrollTop: 0,
  shellScrollLeft: 0,
};

const normalizeTitle = (title?: string | null) => {
  const value = title?.trim();
  return value && value.length > 0 ? value : "Untitled writing";
};

export const createEmptyEditorSession = (): LocalEditorSession => ({
  id: EDITOR_SESSION_RECORD_ID,
  active_tab_id: null,
  tabs: [],
  recent_writings: [],
  updated_at: Date.now(),
});

export const createEditorSessionTab = ({
  id,
  writingId,
  slug = null,
  title,
  saveState = "saved",
  hasPendingSync = false,
  lastTouchedAt = Date.now(),
  viewState,
}: EditorSessionTabInput): LocalEditorSessionTab => ({
  id,
  writing_id: writingId,
  slug,
  title: normalizeTitle(title),
  save_state: saveState,
  has_pending_sync: hasPendingSync,
  last_touched_at: lastTouchedAt,
  view_state: viewState
    ? {
        ...DEFAULT_VIEW_STATE,
        ...viewState,
      }
    : DEFAULT_VIEW_STATE,
});

export const mergeEditorTabViewState = (
  current: LocalEditorTabViewState | null | undefined,
  next?: Partial<LocalEditorTabViewState> | null,
): LocalEditorTabViewState => ({
  ...DEFAULT_VIEW_STATE,
  ...(current ?? {}),
  ...(next ?? {}),
});

export const createRecentWritingEntry = (tab: LocalEditorSessionTab): LocalEditorRecentWriting | null => {
  if (!tab.writing_id) {
    return null;
  }

  return {
    writing_id: tab.writing_id,
    slug: tab.slug ?? null,
    title: tab.title,
    last_touched_at: tab.last_touched_at,
  };
};

export const sortRecentWritings = (entries: LocalEditorRecentWriting[]) =>
  [...entries].sort((left, right) => right.last_touched_at - left.last_touched_at);

export const clampRecentWritings = (entries: LocalEditorRecentWriting[]) =>
  sortRecentWritings(entries).slice(0, EDITOR_MAX_RECENTS);

export const findTabIndexByWritingId = (
  tabs: LocalEditorSessionTab[],
  writingId: string | null,
) => tabs.findIndex((tab) => tab.writing_id === writingId);

export const reorderEditorSessionTabs = (
  tabs: LocalEditorSessionTab[],
  fromTabId: string,
  toTabId: string,
): LocalEditorSessionTab[] => {
  if (fromTabId === toTabId) {
    return tabs;
  }

  const fromIndex = tabs.findIndex((tab) => tab.id === fromTabId);
  const toIndex = tabs.findIndex((tab) => tab.id === toTabId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(fromIndex, 1);
  if (!movedTab) {
    return tabs;
  }

  nextTabs.splice(toIndex, 0, movedTab);
  return nextTabs;
};

export const isDraftTab = (tabId: string, writingId: string | null) =>
  tabId === EDITOR_DRAFT_TAB_ID || writingId === null;

export const mapSaveStateFromSyncStatus = (
  syncStatus: "synced" | "pending" | "failed" | "deleted",
  isOnline: boolean,
): EditorTabSaveState => {
  if (syncStatus === "failed") {
    return "error";
  }

  if (syncStatus === "synced") {
    return "saved";
  }

  if (!isOnline) {
    return "saved-local";
  }

  return "saving";
};

export const sanitizeEditorTabMode = (mode: EditorTabMode | null | undefined): EditorTabMode =>
  mode === "markdown" ? "markdown" : "rich";
