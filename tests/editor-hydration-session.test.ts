import { describe, expect, it } from "vitest"
import {
  createBlankDraftIdentity,
  createNewWritingSessionState,
  createRouteHydrationSessionState,
  resolveExternalWritingLoad,
} from "../lib/editor/hydration-session"

describe("editor hydration session state", () => {
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
})
