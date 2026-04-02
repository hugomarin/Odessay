/**
 * ODE-63 — writing_shares helpers
 *
 * Covers:
 *   - parseUserSearchQuery: validates and normalizes search input
 *   - parseSharePayload: validates POST/DELETE body for sharing routes
 *   - buildExcerpt: truncates body_text for /shared list display
 *   - buildSharedWritingListItem: normalizes DB row into list item
 *
 * Note: RLS enforcement is verified manually via Supabase MCP as per
 * the brief validation section (requires live DB connection).
 */

import { describe, expect, it } from "vitest"
import {
  parseUserSearchQuery,
  parseSharePayload,
  buildExcerpt,
  buildSharedWritingListItem,
} from "@/lib/sharing/writing-shares"

// ---------------------------------------------------------------------------
// 1. parseUserSearchQuery
// ---------------------------------------------------------------------------

describe("parseUserSearchQuery", () => {
  it("returns trimmed string for valid queries", () => {
    expect(parseUserSearchQuery("  hugo  ")).toBe("hugo")
    expect(parseUserSearchQuery("ana")).toBe("ana")
    expect(parseUserSearchQuery("  ab  ")).toBe("ab")
  })

  it("returns null for queries shorter than 2 chars after trim", () => {
    expect(parseUserSearchQuery("a")).toBeNull()
    expect(parseUserSearchQuery("  ")).toBeNull()
    expect(parseUserSearchQuery("")).toBeNull()
  })

  it("returns null for non-string values", () => {
    expect(parseUserSearchQuery(null)).toBeNull()
    expect(parseUserSearchQuery(undefined)).toBeNull()
    expect(parseUserSearchQuery(42)).toBeNull()
    expect(parseUserSearchQuery({ q: "hugo" })).toBeNull()
  })

  it("accepts exactly 2 characters", () => {
    expect(parseUserSearchQuery("ab")).toBe("ab")
  })
})

// ---------------------------------------------------------------------------
// 2. parseSharePayload (POST share / DELETE revoke body)
// ---------------------------------------------------------------------------

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"

describe("parseSharePayload", () => {
  it("returns payload for a valid UUID shared_with_id", () => {
    expect(parseSharePayload({ shared_with_id: VALID_UUID })).toEqual({
      shared_with_id: VALID_UUID,
    })
  })

  it("returns null when shared_with_id is missing", () => {
    expect(parseSharePayload({})).toBeNull()
    expect(parseSharePayload({ other_field: VALID_UUID })).toBeNull()
  })

  it("returns null when shared_with_id is not a valid UUID", () => {
    expect(parseSharePayload({ shared_with_id: "not-a-uuid" })).toBeNull()
    expect(parseSharePayload({ shared_with_id: "" })).toBeNull()
    expect(parseSharePayload({ shared_with_id: "123" })).toBeNull()
  })

  it("returns null for null, undefined, or non-object body", () => {
    expect(parseSharePayload(null)).toBeNull()
    expect(parseSharePayload(undefined)).toBeNull()
    expect(parseSharePayload("string")).toBeNull()
    expect(parseSharePayload(42)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. buildExcerpt
// ---------------------------------------------------------------------------

describe("buildExcerpt", () => {
  it("returns the full text when shorter than maxLen", () => {
    expect(buildExcerpt("Hello world", 120)).toBe("Hello world")
  })

  it("returns the full text when exactly maxLen", () => {
    const text = "a".repeat(120)
    expect(buildExcerpt(text, 120)).toBe(text)
  })

  it("truncates at word boundary with ellipsis", () => {
    const text = "a".repeat(50) + " " + "b".repeat(80)
    const result = buildExcerpt(text, 60)
    expect(result.endsWith("…")).toBe(true)
    // must not exceed maxLen + ellipsis char
    expect(result.length).toBeLessThanOrEqual(61)
  })

  it("falls back to hard cut when no spaces exist", () => {
    const text = "a".repeat(200)
    const result = buildExcerpt(text, 120)
    expect(result).toBe("a".repeat(120) + "…")
  })

  it("trims leading and trailing whitespace before measuring", () => {
    expect(buildExcerpt("  hello  ", 120)).toBe("hello")
  })
})

// ---------------------------------------------------------------------------
// 4. buildSharedWritingListItem
// ---------------------------------------------------------------------------

describe("buildSharedWritingListItem", () => {
  const baseWriting = {
    id: "w-1",
    title: "Epistle to a friend",
    slug: "epistle-to-a-friend",
    body_text: "This is the body of the writing.",
    updated_at: "2026-03-31T00:00:00Z",
  }

  const baseAuthor = { username: "hugo", display_name: "Hugo Marín" }

  it("maps all fields correctly with a valid author", () => {
    const item = buildSharedWritingListItem(baseWriting, baseAuthor)
    expect(item.id).toBe("w-1")
    expect(item.title).toBe("Epistle to a friend")
    expect(item.excerpt).toBe("This is the body of the writing.")
    expect(item.updatedAt).toBe("2026-03-31T00:00:00Z")
    expect(item.author?.username).toBe("hugo")
    expect(item.author?.displayName).toBe("Hugo Marín")
  })

  it("sets author to null when profile is null", () => {
    const item = buildSharedWritingListItem(baseWriting, null)
    expect(item.author).toBeNull()
  })

  it("passes through null title", () => {
    const item = buildSharedWritingListItem({ ...baseWriting, title: null }, baseAuthor)
    expect(item.title).toBeNull()
  })

  it("truncates long body_text in excerpt", () => {
    const longBody = "word ".repeat(100)
    const item = buildSharedWritingListItem({ ...baseWriting, body_text: longBody }, baseAuthor)
    expect(item.excerpt.endsWith("…")).toBe(true)
    expect(item.excerpt.length).toBeLessThanOrEqual(121)
  })
})
