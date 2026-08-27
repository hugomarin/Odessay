import { describe, expect, it } from "vitest"
import {
  createBlankDraftIdentity,
  createNewWritingSessionState,
  createRouteHydrationSessionState,
  resolvePersistedSessionRestore,
  resolvePersistedSessionRestoreTransition,
  resolveUnavailableWritingRecovery,
  resolveExternalWritingLoad,
} from "../lib/editor/hydration-session"

describe("editor hydration session state", () => {
  it("keeps contentless /write without a durable identity or hydration target", () => {
    expect(createRouteHydrationSessionState(null)).toEqual({
      activeWritingId: null,
      hydrationWritingId: null,
    })
  })
  it("hydrates the route writing on the initial load", () => {
    expect(createRouteHydrationSessionState("writing-1")).toEqual({
      activeWritingId: "writing-1",
      hydrationWritingId: "writing-1",
    })
  })

  it("keeps new in-session writings out of the external hydration path", () => {
    expect(createNewWritingSessionState("writing-2")).toEqual({
      activeWritingId: "writing-2",
      hydrationWritingId: null,
    })
  })

  it("hydrates only external route changes", () => {
    expect(resolveExternalWritingLoad("writing-1", "writing-1")).toBeNull()
    expect(resolveExternalWritingLoad("writing-1", "writing-3")).toEqual({
      activeWritingId: "writing-3",
      hydrationWritingId: "writing-3",
    })
    expect(resolveExternalWritingLoad("writing-1", null)).toEqual({
      activeWritingId: null,
      hydrationWritingId: null,
    })
  })

  it("creates a blank draft identity with a stable UUID and no hydration", () => {
    const identity = createBlankDraftIdentity()

    expect(identity.writingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(identity.sessionState).toEqual({
      activeWritingId: identity.writingId,
      hydrationWritingId: null,
    })
  })

  it("does not turn navigation away from a blank route into hydration", () => {
    expect(resolveExternalWritingLoad(null, null)).toBeNull()
  })

  it("hands a persisted active UUID to hydration before any fallback", () => {
    expect(resolvePersistedSessionRestore({
      activeTabId: "tab-a",
      tabs: [{ id: "tab-a", writingId: "writing-a" }],
    })).toEqual({ status: "restorable", writingId: "writing-a" })
  })

  it("returns an explicit terminal outcome for empty, draft, and stale sessions", () => {
    expect(resolvePersistedSessionRestore({ activeTabId: null, tabs: [] })).toEqual({
      status: "no-restorable-tab",
    })
    expect(resolvePersistedSessionRestore({
      activeTabId: "draft",
      tabs: [{ id: "draft", writingId: null }],
    })).toEqual({ status: "no-restorable-tab" })
    expect(resolvePersistedSessionRestore({
      activeTabId: "missing",
      tabs: [{ id: "tab-a", writingId: "writing-a" }],
    })).toEqual({ status: "no-restorable-tab" })
  })

  describe("persisted session restore transitions", () => {
    it.each([
      {
        name: "hands a restorable desktop UUID to hydration",
        session: {
          activeTabId: "tab-a",
          tabs: [{ id: "tab-a", writingId: "writing-a", slug: "letter-a" }],
        },
        context: { isDesktopRuntime: true, useHistoryProjection: false },
        expected: {
          status: "restore-writing",
          writingId: "writing-a",
          slug: "letter-a",
          target: "desktop-hydration",
        },
      },
      {
        name: "keeps an empty desktop session empty",
        session: { activeTabId: null, tabs: [] },
        context: { isDesktopRuntime: true, useHistoryProjection: false },
        expected: { status: "remain-empty" },
      },
      {
        name: "emits one draft-tab action for a non-restorable non-empty session",
        session: {
          activeTabId: "draft",
          tabs: [{ id: "draft", writingId: null }],
        },
        context: { isDesktopRuntime: true, useHistoryProjection: false },
        expected: { status: "open-draft-tab" },
      },
      {
        name: "keeps the web performance harness on history projection",
        session: {
          activeTabId: "tab-a",
          tabs: [{ id: "tab-a", writingId: "writing-a" }],
        },
        context: { isDesktopRuntime: false, useHistoryProjection: true },
        expected: {
          status: "restore-writing",
          writingId: "writing-a",
          slug: null,
          target: "history",
        },
      },
    ])("$name", ({ session, context, expected }) => {
      expect(resolvePersistedSessionRestoreTransition(session, context)).toEqual(expected)
    })
  })

  describe("unavailable writing recovery transitions", () => {
    it.each([
      {
        name: "does not displace the active writing after a background removal",
        reconciliation: { removed: true, removedActive: false, fallbackTabId: "tab-b" },
        tabs: [{ id: "tab-b", writingId: "writing-b" }],
        expected: { status: "clear-hydration" },
      },
      {
        name: "activates a valid sibling by UUID",
        reconciliation: { removed: true, removedActive: true, fallbackTabId: "tab-b" },
        tabs: [{ id: "tab-b", writingId: "writing-b", slug: "letter-b" }],
        expected: { status: "activate-writing", writingId: "writing-b", slug: "letter-b" },
      },
      {
        name: "shows the empty editor when no sibling remains",
        reconciliation: { removed: true, removedActive: true, fallbackTabId: null },
        tabs: [],
        expected: { status: "show-empty-editor" },
      },
      {
        name: "never treats a fallback tab without identity as a document",
        reconciliation: { removed: true, removedActive: true, fallbackTabId: "draft" },
        tabs: [{ id: "draft", writingId: null }],
        expected: { status: "show-empty-editor" },
      },
    ])("$name", ({ reconciliation, tabs, expected }) => {
      expect(resolveUnavailableWritingRecovery(reconciliation, tabs)).toEqual(expected)
    })
  })
})
