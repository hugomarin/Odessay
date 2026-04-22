import { describe, expect, it } from "vitest"
import { resolveWriteDetailRoute } from "@/lib/writings/write-detail-route"

describe("write detail route resolution", () => {
  it("routes UUID identifiers to editor as a fallback for local-only drafts", () => {
    expect(resolveWriteDetailRoute("550e8400-e29b-41d4-a716-446655440000", null)).toEqual({
      kind: "editor",
      writingId: "550e8400-e29b-41d4-a716-446655440000",
    })
  })

  it("returns not-found for missing semantic identifiers", () => {
    expect(resolveWriteDetailRoute("semantic-slug", null)).toEqual({ kind: "not-found" })
  })

  it("redirects UUID requests to canonical slug when available", () => {
    expect(
      resolveWriteDetailRoute("550e8400-e29b-41d4-a716-446655440000", {
        id: "550e8400-e29b-41d4-a716-446655440000",
        slug: "a-better-title",
      }),
    ).toEqual({
      kind: "redirect",
      href: "/write/a-better-title",
    })
  })

  it("loads editor directly on canonical slug", () => {
    expect(
      resolveWriteDetailRoute("a-better-title", {
        id: "550e8400-e29b-41d4-a716-446655440000",
        slug: "a-better-title",
      }),
    ).toEqual({
      kind: "editor",
      writingId: "550e8400-e29b-41d4-a716-446655440000",
    })
  })
})
