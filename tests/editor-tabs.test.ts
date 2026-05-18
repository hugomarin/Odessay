import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyEditorSession } from "../lib/local-db/editor-sessions"
import { localDB, setLocalDBScope } from "../lib/local-db"
import {
  closeTab,
  getEditorSessionState,
  initializeEditorSessionStore,
  openWritingTab,
  resetEditorSessionStoreForTests,
} from "../lib/stores/editor-session-store"

beforeEach(async () => {
  vi.stubGlobal("window", globalThis)
  resetEditorSessionStoreForTests()
  setLocalDBScope(`editor-tabs-${crypto.randomUUID()}`)
  await localDB.editorSessions.save(createEmptyEditorSession())
})

describe("closing the last editor tab", () => {
  it("returns null for the next active tab when the only tab is closed", async () => {
    await initializeEditorSessionStore()
    openWritingTab({ writingId: "solo-writing", title: "Solo" })

    const nextActive = closeTab("solo-writing")

    expect(nextActive).toBeNull()
  })

  it("leaves the session with an empty tab list and null active_tab_id", async () => {
    await initializeEditorSessionStore()
    openWritingTab({ writingId: "last-writing", title: "Last" })

    closeTab("last-writing")

    const session = getEditorSessionState().session
    expect(session.tabs).toHaveLength(0)
    expect(session.active_tab_id).toBeNull()
  })

  it("closing the last of multiple tabs produces an empty session", async () => {
    await initializeEditorSessionStore()
    openWritingTab({ writingId: "w1", title: "One" })
    openWritingTab({ writingId: "w2", title: "Two" })

    closeTab("w1")
    closeTab("w2")

    const session = getEditorSessionState().session
    expect(session.tabs).toHaveLength(0)
    expect(session.active_tab_id).toBeNull()
  })

  it("closing a non-active tab when it is the last tab still leaves an empty session", async () => {
    await initializeEditorSessionStore()
    openWritingTab({ writingId: "active", title: "Active" })
    openWritingTab({ writingId: "background", title: "Background" })
    // Close the background tab first to make "active" the only one, then close it
    closeTab("background")
    closeTab("active")

    const session = getEditorSessionState().session
    expect(session.tabs).toHaveLength(0)
    expect(session.active_tab_id).toBeNull()
  })
})
