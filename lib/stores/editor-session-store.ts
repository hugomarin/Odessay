"use client"

import { useSyncExternalStore } from "react";
import {
  clampRecentWritings,
  createEditorSessionTab,
  createEmptyEditorSession,
  createRecentWritingEntry,
  EDITOR_DRAFT_TAB_ID,
  EDITOR_SOFT_TAB_LIMIT,
  findTabIndexByWritingId,
  isDraftTab,
  mergeEditorTabViewState,
  reorderEditorSessionTabs,
} from "@/lib/local-db/editor-sessions";
import { emitEditorSessionChange, readEditorSession, writeEditorSession } from "@/lib/editor/session-persistence";
import { syncStudioSessionFromEditorTabs } from "@/lib/stores/studio-session-store";
import type {
  EditorTabSaveState,
  LocalEditorRecentWriting,
  LocalEditorSession,
  LocalEditorSessionTab,
  LocalEditorTabViewState,
} from "@/lib/local-db/schema";

type EditorSessionState = {
  loaded: boolean;
  loading: boolean;
  session: LocalEditorSession;
};

type EditorSessionListener = () => void;

type OpenWritingInput = {
  writingId: string;
  slug?: string | null;
  title?: string | null;
  saveState?: EditorTabSaveState;
  hasPendingSync?: boolean;
  replaceDraft?: boolean;
};

type PublishTabInput = {
  routeWritingId: string | null;
  writingId: string | null;
  slug?: string | null;
  title?: string | null;
  saveState: EditorTabSaveState;
  hasPendingSync: boolean;
};

type SaveViewStateInput = {
  tabId: string;
  viewState: Partial<LocalEditorTabViewState>;
};

const DEFAULT_STATE: EditorSessionState = {
  loaded: false,
  loading: false,
  session: createEmptyEditorSession(),
};

let state: EditorSessionState = DEFAULT_STATE;
const listeners = new Set<EditorSessionListener>();
let loadPromise: Promise<void> | null = null;

const emitChange = () => {
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: EditorSessionListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

const persistState = async (session: LocalEditorSession) => {
  await writeEditorSession(session);
  emitEditorSessionChange();
};

const setSessionState = (
  updater: (current: LocalEditorSession) => LocalEditorSession,
  options?: { persist?: boolean },
) => {
  const nextSession = updater(state.session);
  state = {
    ...state,
    loaded: true,
    loading: false,
    session: {
      ...nextSession,
      updated_at: Date.now(),
    },
  };
  syncStudioSessionFromEditorTabs(state.session.tabs, state.session.active_tab_id);
  emitChange();

  if (options?.persist !== false) {
    void persistState(state.session);
  }
};

const touchRecentFromTab = (
  recent: LocalEditorRecentWriting[],
  tab: LocalEditorSessionTab,
): LocalEditorRecentWriting[] => {
  const entry = createRecentWritingEntry(tab);
  if (!entry) {
    return recent;
  }

  return clampRecentWritings([
    entry,
    ...recent.filter((item) => item.writing_id !== entry.writing_id),
  ]);
};

const getFallbackActiveTabId = (tabs: LocalEditorSessionTab[], preferredId?: string | null) => {
  if (preferredId && tabs.some((tab) => tab.id === preferredId)) {
    return preferredId;
  }

  return tabs[0]?.id ?? null;
};

export function useEditorSessionStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STATE);
}

export function initializeEditorSessionStore() {
  if (state.loaded) {
    return Promise.resolve();
  }

  if (loadPromise) {
    return loadPromise;
  }

  state = {
    ...state,
    loading: true,
  };
  emitChange();

  loadPromise = readEditorSession()
    .then((session) => {
      state = {
        loaded: true,
        loading: false,
        session,
      };
      emitChange();
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

export function openDraftTab() {
  setSessionState((current) => {
    const existingDraft = current.tabs.find((tab) => isDraftTab(tab.id, tab.writing_id));
    if (existingDraft && current.active_tab_id === existingDraft.id) {
      return current;
    }
    const nextTabs = existingDraft
      ? current.tabs.map((tab) =>
          tab.id === existingDraft.id
            ? {
                ...tab,
                last_touched_at: Date.now(),
              }
            : tab,
        )
      : [
          ...current.tabs,
          createEditorSessionTab({
            id: EDITOR_DRAFT_TAB_ID,
            writingId: null,
            title: "Untitled writing",
            saveState: "saved",
          }),
        ];

    return {
      ...current,
      active_tab_id: existingDraft?.id ?? EDITOR_DRAFT_TAB_ID,
      tabs: nextTabs,
    };
  });
}

export function openWritingTab({
  writingId,
  slug = null,
  title,
  saveState = "saved",
  hasPendingSync = false,
  replaceDraft = false,
}: OpenWritingInput) {
  let opened = true;

  setSessionState((current) => {
    const existingIndex = findTabIndexByWritingId(current.tabs, writingId);
    if (existingIndex >= 0) {
      const existingTab = current.tabs[existingIndex]!;
      if (
        current.active_tab_id === existingTab.id &&
        existingTab.slug === slug &&
        existingTab.title === (title?.trim() || existingTab.title) &&
        existingTab.save_state === saveState &&
        existingTab.has_pending_sync === hasPendingSync
      ) {
        return current;
      }

      const nextTab: LocalEditorSessionTab = {
        ...existingTab,
        slug,
        title: title?.trim() || existingTab.title,
        save_state: saveState,
        has_pending_sync: hasPendingSync,
        last_touched_at: Date.now(),
      };
      const nextTabs = current.tabs.map((tab, index) => (index === existingIndex ? nextTab : tab));
      return {
        ...current,
        active_tab_id: nextTab.id,
        tabs: nextTabs,
        recent_writings: touchRecentFromTab(current.recent_writings, nextTab),
      };
    }

    if (current.tabs.length >= EDITOR_SOFT_TAB_LIMIT && !replaceDraft) {
      opened = false;
      return current;
    }

    const nextTab = createEditorSessionTab({
      id: writingId,
      writingId,
      slug,
      title,
      saveState,
      hasPendingSync,
    });

    const currentTabs = replaceDraft
      ? current.tabs.filter((tab) => !isDraftTab(tab.id, tab.writing_id))
      : current.tabs;

    return {
      ...current,
      active_tab_id: nextTab.id,
      tabs: [...currentTabs, nextTab],
      recent_writings: touchRecentFromTab(current.recent_writings, nextTab),
    };
  });

  return opened;
}

export function focusTab(tabId: string) {
  setSessionState((current) => {
    if (current.active_tab_id === tabId) {
      return current;
    }

    const tab = current.tabs.find((item) => item.id === tabId);
    if (!tab) {
      return current;
    }

    const nextTab = {
      ...tab,
      last_touched_at: Date.now(),
    };

    return {
      ...current,
      active_tab_id: nextTab.id,
      tabs: current.tabs.map((item) => (item.id === tabId ? nextTab : item)),
      recent_writings: touchRecentFromTab(current.recent_writings, nextTab),
    };
  });
}

export function publishTabState({
  routeWritingId,
  writingId,
  slug = null,
  title,
  saveState,
  hasPendingSync,
}: PublishTabInput) {
  const now = Date.now();

  setSessionState((current) => {
    const targetTabId = writingId ?? EDITOR_DRAFT_TAB_ID;
    const nextTabs = [...current.tabs];
    const routeIndex = routeWritingId ? findTabIndexByWritingId(nextTabs, routeWritingId) : -1;
    const writingIndex = writingId ? findTabIndexByWritingId(nextTabs, writingId) : -1;
    const draftIndex = nextTabs.findIndex((tab) => isDraftTab(tab.id, tab.writing_id));

    const titleValue = title?.trim() || "Untitled writing";
    const baseTab = createEditorSessionTab({
      id: targetTabId,
      writingId,
      slug,
      title: titleValue,
      saveState,
      hasPendingSync,
      lastTouchedAt: now,
      viewState:
        routeIndex >= 0
          ? nextTabs[routeIndex]?.view_state
          : writingIndex >= 0
            ? nextTabs[writingIndex]?.view_state
            : draftIndex >= 0
              ? nextTabs[draftIndex]?.view_state
              : undefined,
    });

    if (routeIndex >= 0) {
      nextTabs[routeIndex] = {
        ...nextTabs[routeIndex]!,
        ...baseTab,
      };
    } else if (writingIndex >= 0) {
      nextTabs[writingIndex] = {
        ...nextTabs[writingIndex]!,
        ...baseTab,
      };
    } else if (draftIndex >= 0) {
      nextTabs[draftIndex] = {
        ...nextTabs[draftIndex]!,
        ...baseTab,
      };
    } else {
      nextTabs.unshift(baseTab);
    }

    return {
      ...current,
      active_tab_id: targetTabId,
      tabs: nextTabs,
      recent_writings: touchRecentFromTab(current.recent_writings, baseTab),
    };
  });
}

export function saveTabViewState({ tabId, viewState }: SaveViewStateInput) {
  setSessionState(
    (current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              view_state: mergeEditorTabViewState(tab.view_state, viewState),
            }
          : tab,
      ),
    }),
    { persist: true },
  );
}

export function closeTab(tabId: string) {
  let nextActiveTabId: string | null = null;

  setSessionState((current) => {
    const index = current.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      nextActiveTabId = current.active_tab_id;
      return current;
    }

    const remainingTabs = current.tabs.filter((tab) => tab.id !== tabId);
    nextActiveTabId =
      current.active_tab_id === tabId
        ? remainingTabs[index]?.id ?? remainingTabs[index - 1]?.id ?? null
        : current.active_tab_id;

    return {
      ...current,
      active_tab_id: getFallbackActiveTabId(remainingTabs, nextActiveTabId),
      tabs: remainingTabs,
    };
  });

  return nextActiveTabId;
}

export type ReconcileUnavailableTabResult = {
  removed: boolean;
  removedActive: boolean;
  fallbackTabId: string | null;
};

export function reconcileUnavailableWritingTab(writingId: string): ReconcileUnavailableTabResult {
  let result: ReconcileUnavailableTabResult = {
    removed: false,
    removedActive: false,
    fallbackTabId: null,
  };

  setSessionState((current) => {
    const staleIndex = findTabIndexByWritingId(current.tabs, writingId);
    if (staleIndex < 0) {
      return current;
    }

    const staleTab = current.tabs[staleIndex]!;
    const remainingTabs = current.tabs.filter((_, index) => index !== staleIndex);
    const removedActive = current.active_tab_id === staleTab.id;

    const nextActiveTabId = removedActive
      ? remainingTabs[staleIndex]?.id ?? remainingTabs[staleIndex - 1]?.id ?? null
      : current.active_tab_id;

    const fallbackTabId = getFallbackActiveTabId(remainingTabs, nextActiveTabId);

    result = {
      removed: true,
      removedActive,
      fallbackTabId,
    };

    return {
      ...current,
      active_tab_id: fallbackTabId,
      tabs: remainingTabs,
      recent_writings: current.recent_writings.filter((item) => item.writing_id !== writingId),
    };
  });

  return result;
}

export function reorderTab(tabId: string, targetTabId: string) {
  setSessionState((current) => {
    const nextTabs = reorderEditorSessionTabs(current.tabs, tabId, targetTabId);
    if (nextTabs === current.tabs) {
      return current;
    }

    return {
      ...current,
      tabs: nextTabs,
    };
  });
}

export function getEditorSessionState() {
  return state;
}

/**
 * Refresh cached presentation metadata for already-open writings without
 * changing document identity, tab order, focus or editor view state.
 *
 * The DocumentCatalog owns the current title projection on desktop. The
 * session store only caches that title for rendering and persistence, so a
 * filesystem rename must update every matching tab/recent entry by UUID.
 */
export function syncWritingTitlesFromCatalog(titlesByWritingId: ReadonlyMap<string, string>) {
  if (titlesByWritingId.size === 0) {
    return false;
  }

  const normalizedTitles = new Map<string, string>();
  titlesByWritingId.forEach((title, writingId) => {
    const normalized = title.trim();
    if (normalized) {
      normalizedTitles.set(writingId, normalized);
    }
  });

  if (normalizedTitles.size === 0) {
    return false;
  }

  const hasChangedTitle =
    state.session.tabs.some((tab) => {
      const title = tab.writing_id ? normalizedTitles.get(tab.writing_id) : null;
      return Boolean(title && title !== tab.title);
    }) ||
    state.session.recent_writings.some((entry) => {
      const title = normalizedTitles.get(entry.writing_id);
      return Boolean(title && title !== entry.title);
    });

  if (!hasChangedTitle) {
    return false;
  }

  setSessionState((current) => ({
    ...current,
    tabs: current.tabs.map((tab) => {
      const title = tab.writing_id ? normalizedTitles.get(tab.writing_id) : null;
      return title && title !== tab.title ? { ...tab, title } : tab;
    }),
    recent_writings: current.recent_writings.map((entry) => {
      const title = normalizedTitles.get(entry.writing_id);
      return title && title !== entry.title ? { ...entry, title } : entry;
    }),
  }));

  return true;
}

export function resetEditorSessionStoreForTests() {
  state = DEFAULT_STATE;
  loadPromise = null;
  emitChange();
}
