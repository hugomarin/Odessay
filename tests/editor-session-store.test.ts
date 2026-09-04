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
  reconcileMaterializedDraftTab,
  reconcileUnavailableWritingTab,
  reorderTab,
  resetEditorSessionStoreForTests,
  saveTabViewState,
  syncWritingTitlesFromCatalog,
} from "../lib/stores/editor-session-store";
import { getStudioSessionState, resetStudioSessionForTests } from "../lib/stores/studio-session-store";

beforeEach(async () => {
  vi.stubGlobal("window", globalThis);
  resetEditorSessionStoreForTests();
  resetStudioSessionForTests();
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

  it("keeps tabs empty and active_tab_id null after closing the last tab", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-only", title: "Only writing" });

    expect(closeTab("writing-only")).toBeNull();
    expect(getEditorSessionState().session).toMatchObject({
      tabs: [],
      active_tab_id: null,
    });
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

  it("reorders tabs without changing the active tab", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-1", title: "First draft" });
    openWritingTab({ writingId: "writing-2", title: "Second draft" });
    openWritingTab({ writingId: "writing-3", title: "Third draft" });

    reorderTab("writing-1", "writing-3");

    const session = getEditorSessionState().session;
    expect(session.active_tab_id).toBe("writing-3");
    expect(session.tabs.map((tab) => tab.id)).toEqual([
      "writing-2",
      "writing-3",
      "writing-1",
    ]);
  });

  it("keeps Studio mirrored to the reordered tab order", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-1", title: "First draft" });
    openWritingTab({ writingId: "writing-2", title: "Second draft" });
    openWritingTab({ writingId: "writing-3", title: "Third draft" });

    reorderTab("writing-3", "writing-1");

    expect(getStudioSessionState().activeArtifactId).toBe("writing-3");
    expect(getStudioSessionState().artifacts.map((artifact) => artifact.id)).toEqual([
      "writing-3",
      "writing-1",
      "writing-2",
    ]);
  });

  it("updates open tabs, recents and Studio when the catalog title changes", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-1", title: "Case4" });
    openWritingTab({ writingId: "writing-2", title: "Unchanged" });

    const changed = syncWritingTitlesFromCatalog(new Map([
      ["writing-1", "Case4-renamed"],
    ]));

    const session = getEditorSessionState().session;
    expect(changed).toBe(true);
    expect(session.tabs.find((tab) => tab.writing_id === "writing-1")?.title).toBe("Case4-renamed");
    expect(session.tabs.find((tab) => tab.writing_id === "writing-2")?.title).toBe("Unchanged");
    expect(session.recent_writings.find((entry) => entry.writing_id === "writing-1")?.title).toBe("Case4-renamed");
    expect(getStudioSessionState().artifacts.find((artifact) => artifact.writingId === "writing-1")?.title).toBe("Case4-renamed");
  });

  it("does not rewrite the session when catalog titles are unchanged", async () => {
    await initializeEditorSessionStore();
    openWritingTab({ writingId: "writing-1", title: "Case4" });

    const updatedAt = getEditorSessionState().session.updated_at;
    const changed = syncWritingTitlesFromCatalog(new Map([["writing-1", "Case4"]]));

    expect(changed).toBe(false);
    expect(getEditorSessionState().session.updated_at).toBe(updatedAt);
  });

  describe("reconcileMaterializedDraftTab — ODE-478 follow-up", () => {
    it("renames the still-current draft tab in place when it belongs to this materialization", async () => {
      await initializeEditorSessionStore();
      openDraftTab("draft-a");

      reconcileMaterializedDraftTab({
        writingId: "writing-a",
        draftTabId: EDITOR_DRAFT_TAB_ID,
        draftWritingId: "draft-a",
        title: "First real title",
      });

      const session = getEditorSessionState().session;
      expect(session.tabs).toHaveLength(1);
      expect(session.tabs[0]).toMatchObject({ id: "writing-a", writing_id: "writing-a", title: "First real title" });
      expect(session.active_tab_id).toBe("writing-a");
    });

    it("does not hijack a newer draft session that reused the same tab id", async () => {
      await initializeEditorSessionStore();
      // Draft A occupies the singleton draft tab slot...
      openDraftTab("draft-a");
      // ...then gets abandoned by "New Tab", which reuses the same slot for
      // a fresh draft B before A's materialization has resolved.
      openDraftTab("draft-b");

      // A's background write finally lands.
      reconcileMaterializedDraftTab({
        writingId: "writing-a",
        draftTabId: EDITOR_DRAFT_TAB_ID,
        draftWritingId: "draft-a",
        title: "Draft A's title",
      });

      const session = getEditorSessionState().session;
      // The visible draft tab must still be B, untouched and still blank —
      // not renamed to A's identity.
      const draftTab = session.tabs.find((tab) => tab.id === EDITOR_DRAFT_TAB_ID);
      expect(draftTab).toMatchObject({ id: EDITOR_DRAFT_TAB_ID, writing_id: null, draft_writing_id: "draft-b" });
      expect(session.active_tab_id).toBe(EDITOR_DRAFT_TAB_ID);

      // A's write must still be owned by *some* tab — never orphaned.
      const materializedTab = session.tabs.find((tab) => tab.writing_id === "writing-a");
      expect(materializedTab).toBeDefined();
      expect(materializedTab?.id).not.toBe(EDITOR_DRAFT_TAB_ID);
    });

    it("treats a tab with no draft_writing_id (older session) as compatible", async () => {
      await initializeEditorSessionStore();
      openDraftTab();

      reconcileMaterializedDraftTab({
        writingId: "writing-legacy",
        draftTabId: EDITOR_DRAFT_TAB_ID,
        draftWritingId: "draft-new",
        title: "Legacy tab",
      });

      const session = getEditorSessionState().session;
      expect(session.tabs).toHaveLength(1);
      expect(session.tabs[0]).toMatchObject({ id: "writing-legacy", writing_id: "writing-legacy" });
    });
  });

  describe("reconcileUnavailableWritingTab", () => {
    it("removes a background stale tab without changing the active tab", async () => {
      await initializeEditorSessionStore();
      openWritingTab({ writingId: "writing-1", title: "First" });
      openWritingTab({ writingId: "writing-2", title: "Second" });
      openWritingTab({ writingId: "writing-3", title: "Third" });

      const result = reconcileUnavailableWritingTab("writing-1");

      expect(result).toMatchObject({ removed: true, removedActive: false, fallbackTabId: "writing-3" });
      const session = getEditorSessionState().session;
      expect(session.tabs.map((tab) => tab.writing_id)).toEqual(["writing-2", "writing-3"]);
      expect(session.active_tab_id).toBe("writing-3");
    });

    it("removes the active stale tab and moves to the next valid tab", async () => {
      await initializeEditorSessionStore();
      openWritingTab({ writingId: "writing-1", title: "First" });
      openWritingTab({ writingId: "writing-2", title: "Second" });
      openWritingTab({ writingId: "writing-3", title: "Third" });

      const result = reconcileUnavailableWritingTab("writing-3");

      expect(result).toMatchObject({ removed: true, removedActive: true, fallbackTabId: "writing-2" });
      const session = getEditorSessionState().session;
      expect(session.tabs.map((tab) => tab.writing_id)).toEqual(["writing-1", "writing-2"]);
      expect(session.active_tab_id).toBe("writing-2");
    });

    it("removes the only tab and leaves the session empty for the caller to fall back", async () => {
      await initializeEditorSessionStore();
      openWritingTab({ writingId: "writing-1", title: "Only" });

      const result = reconcileUnavailableWritingTab("writing-1");

      expect(result).toMatchObject({ removed: true, removedActive: true, fallbackTabId: null });
      const session = getEditorSessionState().session;
      expect(session.tabs).toHaveLength(0);
      expect(session.active_tab_id).toBeNull();
    });

    it("removes the stale writing from recent_writings", async () => {
      await initializeEditorSessionStore();
      openWritingTab({ writingId: "writing-1", title: "First" });
      openWritingTab({ writingId: "writing-2", title: "Second" });

      reconcileUnavailableWritingTab("writing-1");

      const session = getEditorSessionState().session;
      expect(session.recent_writings.some((item) => item.writing_id === "writing-1")).toBe(false);
      expect(session.recent_writings.some((item) => item.writing_id === "writing-2")).toBe(true);
    });

    it("is idempotent", async () => {
      await initializeEditorSessionStore();
      openWritingTab({ writingId: "writing-1", title: "First" });
      openWritingTab({ writingId: "writing-2", title: "Second" });

      reconcileUnavailableWritingTab("writing-1");
      reconcileUnavailableWritingTab("writing-1");

      const session = getEditorSessionState().session;
      expect(session.tabs.map((tab) => tab.writing_id)).toEqual(["writing-2"]);
      expect(session.active_tab_id).toBe("writing-2");
    });

    it("is idempotent when the unavailable cloud-only tab is the last tab", async () => {
      await initializeEditorSessionStore();
      openWritingTab({ writingId: "cloud-only", title: "Cloud only" });

      expect(reconcileUnavailableWritingTab("cloud-only")).toMatchObject({
        removed: true,
        fallbackTabId: null,
      });
      expect(reconcileUnavailableWritingTab("cloud-only")).toMatchObject({
        removed: false,
        fallbackTabId: null,
      });
      expect(getEditorSessionState().session).toMatchObject({ tabs: [], active_tab_id: null });
    });
  });
});
