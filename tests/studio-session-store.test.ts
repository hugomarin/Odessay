import { beforeEach, describe, expect, it } from "vitest"
import type { LocalEditorSessionTab } from "../lib/local-db/schema"
import {
  getStudioSessionState,
  resetStudioSessionForTests,
  syncStudioSessionFromEditorTabs,
} from "../lib/stores/studio-session-store"

const createTab = (overrides: Partial<LocalEditorSessionTab>): LocalEditorSessionTab => ({
  id: "writing-1",
  writing_id: "writing-1",
  slug: "writing-1",
  title: "First draft",
  save_state: "saved",
  has_pending_sync: false,
  last_touched_at: 1,
  view_state: null,
  ...overrides,
})

beforeEach(() => {
  resetStudioSessionForTests()
})

describe("studioSessionStore", () => {
  it("maps editor tabs into session-only Studio artifacts", async () => {
    syncStudioSessionFromEditorTabs([
      createTab({ id: "writing-1", writing_id: "writing-1", title: "First draft" }),
      createTab({ id: "draft", writing_id: null, title: "Untitled writing" }),
    ], "writing-1")

    expect(getStudioSessionState()).toEqual({
      activeArtifactId: "writing-1",
      artifacts: [
        expect.objectContaining({
          id: "writing-1",
          writingId: "writing-1",
          title: "First draft",
          href: "/write/writing-1",
        }),
        expect.objectContaining({
          id: "draft",
          writingId: null,
          title: "Untitled writing",
          href: "/write?new=1",
        }),
      ],
    })
  })

  it("keeps open artifacts available until the app session store is reset", () => {
    syncStudioSessionFromEditorTabs([
      createTab({ id: "writing-2", writing_id: "writing-2", title: "Second draft" }),
    ], "writing-2")

    expect(getStudioSessionState().artifacts).toHaveLength(1)

    resetStudioSessionForTests()

    expect(getStudioSessionState()).toEqual({
      activeArtifactId: null,
      artifacts: [],
    })
  })
})
