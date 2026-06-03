import { afterEach, describe, expect, it, vi } from "vitest"
import { buildWritingRouteHref, getWritingRouteIdentifier, isUuidLikeWritingIdentifier } from "@/lib/writings/writing-route"

describe("writing route helpers", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_TAURI_BUILD
    vi.resetModules()
  })

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

  it("uses query-based hrefs (not dynamic path segments) in desktop builds", async () => {
    process.env.NEXT_PUBLIC_TAURI_BUILD = "true"
    const { buildWritingRouteHref: buildDesktopHref, getWritingRouteIdentifier: getDesktopRouteIdentifier } =
      await import("@/lib/writings/writing-route")

    // The desktop static export has no /write/<uuid> file, so links must target
    // the static base route with the id as a query param.
    expect(getDesktopRouteIdentifier({ id: "writing-1", slug: "semantic-title" })).toBe("writing-1")
    expect(buildDesktopHref("/write", { id: "writing-1", slug: "semantic-title" })).toBe("/write?id=writing-1")
  })

  it("detects uuid-like identifiers", () => {
    expect(isUuidLikeWritingIdentifier("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
    expect(isUuidLikeWritingIdentifier("semantic-title")).toBe(false)
  })
})
