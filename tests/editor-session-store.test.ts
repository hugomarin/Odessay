import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEditorSession, EDITOR_DRAFT_TAB_ID } from "../lib/local-db/editor-sessions";
import { localDB, setLocalDBScope } from "../lib/local-db";
import {
  closeTab,
  getEditorSessionState,
  initializeEditorSessionStore,
  openDraftTab,
  openWritingTab,
  publishTabState,
  resetEditorSessionStoreForTests,
  saveTabViewState,
} from "../lib/stores/editor-session-store";

beforeEach(async () => {
  vi.stubGlobal("window", globalThis);
  resetEditorSessionStoreForTests();
  setLocalDBScope(`editor-session-${crypto.randomUUID()}`);
  await localDB.editorSessions.save(createEmptyEditorSession());
});

describe("editorSessionStore", () => {
  it("restores the persisted workspace session", async () => {
    await localDB.editorSessions.save({
      ...createEmptyEditorSession(),
      active_tab_id: "writing-1",
      tabs: [
        {
          id: "writing-1",
          writing_id: "writing-1",
          slug: "draft-1",
          title: "Draft 1",
          save_state: "saved",
          has_pending_sync: false,
          last_touched_at: 1,
          view_state: null,
        },
      ],
    });

    await initializeEditorSessionStore();

    expect(getEditorSessionState().session.active_tab_id).toBe("writing-1");
    expect(getEditorSessionState().session.tabs).toHaveLength(1);
  });

  it("replaces the draft tab when a new writing gets its persisted id", async () => {
    await initializeEditorSessionStore();

    openDraftTab();
    publishTabState({
      routeWritingId: null,
      writingId: "writing-2",
      slug: "writing-2",
      title: "Second draft",
      saveState: "saving",
      hasPendingSync: true,
    });

    const session = getEditorSessionState().session;
    expect(session.active_tab_id).toBe("writing-2");
    expect(session.tabs.some((tab) => tab.id === EDITOR_DRAFT_TAB_ID)).toBe(false);
    expect(session.tabs.at(-1)?.writing_id).toBe("writing-2");
  });

  it("stores per-tab viewport state before tab switches", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-3", title: "Third draft" });

    saveTabViewState({
      tabId: "writing-3",
      viewState: {
        mode: "markdown",
        scrollTop: 120,
        selectionFrom: 4,
        selectionTo: 8,
      },
    });

    const tab = getEditorSessionState().session.tabs.find((item) => item.id === "writing-3");
    expect(tab?.view_state?.mode).toBe("markdown");
    expect(tab?.view_state?.scrollTop).toBe(120);
    expect(tab?.view_state?.selectionFrom).toBe(4);
    expect(tab?.view_state?.selectionTo).toBe(8);
  });

  it("returns the next active tab when closing the current one", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-4", title: "Fourth draft" });
    openWritingTab({ writingId: "writing-5", title: "Fifth draft" });

    const nextActive = closeTab("writing-5");

    expect(nextActive).toBe("writing-4");
    expect(getEditorSessionState().session.active_tab_id).toBe("writing-4");
  });

  it("appends newly opened writing tabs to the end of the rail", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-1", title: "First draft" });
    openWritingTab({ writingId: "writing-2", title: "Second draft" });
    openWritingTab({ writingId: "writing-3", title: "Third draft" });

    expect(getEditorSessionState().session.tabs.map((tab) => tab.id)).toEqual([
      "writing-1",
      "writing-2",
      "writing-3",
    ]);
  });

  it("replaces the draft tab when opening a writing with replaceDraft", async () => {
    await initializeEditorSessionStore();
    openDraftTab();
    openWritingTab({
      writingId: "writing-6",
      title: "Sixth draft",
      replaceDraft: true,
    });

    const session = getEditorSessionState().session;
    expect(session.active_tab_id).toBe("writing-6");
    expect(session.tabs.some((tab) => tab.id === EDITOR_DRAFT_TAB_ID)).toBe(false);
    expect(session.tabs.at(-1)?.writing_id).toBe("writing-6");
  });
});
