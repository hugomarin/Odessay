import { describe, expect, it } from "vitest"
import { buildWritingRouteHref, getWritingRouteIdentifier, isUuidLikeWritingIdentifier } from "@/lib/writings/writing-route"

describe("writing route helpers", () => {
  it("prefers the slug when present", () => {
    expect(getWritingRouteIdentifier({ id: "writing-1", slug: "semantic-title" })).toBe("semantic-title")
  })

  it("falls back to the id when slug is missing", () => {
    expect(getWritingRouteIdentifier({ id: "writing-1", slug: null })).toBe("writing-1")
  })

  it("builds canonical route hrefs", () => {
    expect(buildWritingRouteHref("/shared", { id: "writing-1", slug: "semantic-title" })).toBe(
      "/shared/semantic-title",
    )
  })

  it("detects uuid-like identifiers", () => {
    expect(isUuidLikeWritingIdentifier("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
    expect(isUuidLikeWritingIdentifier("semantic-title")).toBe(false)
  })
})
