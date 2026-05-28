/**
 * ODE-65 — margins utility tests
 *
 * Covers pure domain functions from lib/margins/margins.ts:
 *   - parseCreateMarginPayload: validates POST body
 *   - parsePatchMarginPayload: validates PATCH note body
 *   - parseShareMarginsBatchPayload: validates batch share body
 *   - isValidAnchor: mirrors DB CHECK constraints
 *   - canReaderEdit: authorization check (reader_id === auth.uid)
 *   - areAllMarginsShared: derive share state from margin list
 *   - countAnnotations: count margins with notes
 *   - sortMarginsByPosition: sort by anchor_start
 *
 * Note: RLS enforcement is verified via Supabase MCP as per the
 * brief's validation section (requires live DB connection).
 */

import { describe, expect, it } from "vitest"
import {
  parseCreateMarginPayload,
  parsePatchMarginPayload,
  parseShareMarginsBatchPayload,
  isValidAnchor,
  canReaderEdit,
  areAllMarginsShared,
  countAnnotations,
  sortMarginsByPosition,
  isShared,
  toggleShare,
  getSharedForToken,
  syncMarginsFromBodyJson,
  isLegacyMarginsSchemaError,
  normalizeMarginRecord,
} from "@/lib/margins/margins"

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"

// ─── 1. parseCreateMarginPayload ──────────────────────────────────────────────

describe("parseCreateMarginPayload — highlight creation", () => {
  it("accepts a valid highlight payload (note=null)", () => {
    const payload = parseCreateMarginPayload({
      writing_id: VALID_UUID,
      anchor_start: 0,
      anchor_end: 10,
      anchor_text: "Hello world",
      note: null,
    })
    expect(payload).not.toBeNull()
    expect(payload?.note).toBeNull()
    expect(payload?.anchor_text).toBe("Hello world")
  })

  it("accepts a valid annotation payload (note filled)", () => {
    const payload = parseCreateMarginPayload({
      writing_id: VALID_UUID,
      anchor_start: 5,
      anchor_end: 20,
      anchor_text: "some passage",
      note: "this connects to Davidson",
    })
    expect(payload).not.toBeNull()
    expect(payload?.note).toBe("this connects to Davidson")
  })

  it("accepts payload without note field (undefined → treated as undefined, note optional)", () => {
    const payload = parseCreateMarginPayload({
      writing_id: VALID_UUID,
      anchor_start: 0,
      anchor_end: 5,
      anchor_text: "hello",
    })
    expect(payload).not.toBeNull()
  })

  it("returns null when writing_id is not a UUID", () => {
    expect(
      parseCreateMarginPayload({
        writing_id: "not-a-uuid",
        anchor_start: 0,
        anchor_end: 10,
        anchor_text: "text",
      }),
    ).toBeNull()
  })

  it("returns null when anchor_start is negative", () => {
    expect(
      parseCreateMarginPayload({
        writing_id: VALID_UUID,
        anchor_start: -1,
        anchor_end: 10,
        anchor_text: "text",
      }),
    ).toBeNull()
  })

  it("returns null when anchor_text is empty", () => {
    expect(
      parseCreateMarginPayload({
        writing_id: VALID_UUID,
        anchor_start: 0,
        anchor_end: 10,
        anchor_text: "",
      }),
    ).toBeNull()
  })

  it("returns null for missing required fields", () => {
    expect(parseCreateMarginPayload({})).toBeNull()
    expect(parseCreateMarginPayload(null)).toBeNull()
    expect(parseCreateMarginPayload(undefined)).toBeNull()
  })
})

// ─── 2. parsePatchMarginPayload — annotation edit ─────────────────────────────

describe("parsePatchMarginPayload — annotation edit", () => {
  it("accepts non-null note string", () => {
    const result = parsePatchMarginPayload({ note: "updated annotation" })
    expect(result).toEqual({ note: "updated annotation" })
  })

  it("accepts null note (clearing annotation → highlight only)", () => {
    const result = parsePatchMarginPayload({ note: null })
    expect(result).toEqual({ note: null })
  })

  it("returns null when note field is missing", () => {
    expect(parsePatchMarginPayload({})).toBeNull()
    expect(parsePatchMarginPayload({ other: "field" })).toBeNull()
  })

  it("returns null for non-object body", () => {
    expect(parsePatchMarginPayload(null)).toBeNull()
    expect(parsePatchMarginPayload("string")).toBeNull()
    expect(parsePatchMarginPayload(42)).toBeNull()
  })
})

// ─── 3. parseShareMarginsBatchPayload — share with author ────────────────────

describe("parseShareMarginsBatchPayload — share all margins", () => {
  it("returns parsed payload for a valid writing_id", () => {
    const result = parseShareMarginsBatchPayload({ writing_id: VALID_UUID })
    expect(result).toEqual({ writing_id: VALID_UUID })
  })

  it("returns null when writing_id is not a UUID", () => {
    expect(parseShareMarginsBatchPayload({ writing_id: "not-uuid" })).toBeNull()
  })

  it("returns null when writing_id is missing", () => {
    expect(parseShareMarginsBatchPayload({})).toBeNull()
  })

  it("returns null for null or non-object body", () => {
    expect(parseShareMarginsBatchPayload(null)).toBeNull()
    expect(parseShareMarginsBatchPayload(undefined)).toBeNull()
    expect(parseShareMarginsBatchPayload(42)).toBeNull()
  })
})

// ─── 4. isValidAnchor — mirrors DB CHECK constraints ─────────────────────────

describe("isValidAnchor", () => {
  it("returns true for valid range (end > start ≥ 0)", () => {
    expect(isValidAnchor(0, 10)).toBe(true)
    expect(isValidAnchor(5, 6)).toBe(true)
    expect(isValidAnchor(100, 200)).toBe(true)
  })

  it("returns false when end equals start", () => {
    expect(isValidAnchor(5, 5)).toBe(false)
  })

  it("returns false when end < start", () => {
    expect(isValidAnchor(10, 5)).toBe(false)
  })

  it("returns false when start is negative", () => {
    expect(isValidAnchor(-1, 5)).toBe(false)
  })
})

// ─── 5. canReaderEdit — delete authorization ─────────────────────────────────

describe("canReaderEdit", () => {
  it("returns true when reader_id matches the margin owner", () => {
    expect(canReaderEdit("user-a", "user-a")).toBe(true)
  })

  it("returns false when reader_id does not match", () => {
    expect(canReaderEdit("user-a", "user-b")).toBe(false)
  })
})

// ─── 6. areAllMarginsShared — shared state derivation ────────────────────────

describe("areAllMarginsShared — shared=true visible for author", () => {
  it("returns true when all margins are shared", () => {
    expect(
      areAllMarginsShared([
        { shared: true },
        { shared: true },
      ]),
    ).toBe(true)
  })

  it("returns false when any margin is not shared", () => {
    expect(
      areAllMarginsShared([
        { shared: true },
        { shared: false },
      ]),
    ).toBe(false)
  })

  it("returns false for an empty array (nothing to share)", () => {
    expect(areAllMarginsShared([])).toBe(false)
  })
})

// ─── 7. countAnnotations ─────────────────────────────────────────────────────

describe("countAnnotations", () => {
  it("counts only margins with non-null notes", () => {
    expect(
      countAnnotations([
        { note: "annotation 1" },
        { note: null },
        { note: "annotation 2" },
      ]),
    ).toBe(2)
  })

  it("returns 0 when all margins are highlights (note=null)", () => {
    expect(countAnnotations([{ note: null }, { note: null }])).toBe(0)
  })

  it("returns 0 for empty array", () => {
    expect(countAnnotations([])).toBe(0)
  })
})

// ─── 8. sortMarginsByPosition ────────────────────────────────────────────────

describe("sortMarginsByPosition", () => {
  it("sorts margins by anchor_start ascending (reading order)", () => {
    const margins = [
      { anchor_start: 50, label: "c" },
      { anchor_start: 10, label: "a" },
      { anchor_start: 30, label: "b" },
    ]
    const sorted = sortMarginsByPosition(margins)
    expect(sorted.map((m) => m.label)).toEqual(["a", "b", "c"])
  })

  it("does not mutate the original array", () => {
    const original = [{ anchor_start: 20 }, { anchor_start: 5 }]
    const sorted = sortMarginsByPosition(original)
    expect(original[0].anchor_start).toBe(20)
    expect(sorted[0].anchor_start).toBe(5)
  })

  it("handles an empty array", () => {
    expect(sortMarginsByPosition([])).toEqual([])
  })
})

// ─── 9. isShared ──────────────────────────────────────────────────────────────

describe("isShared", () => {
  it("returns true when shared is true", () => {
    expect(isShared({ shared: true })).toBe(true)
  })

  it("returns false when shared is false", () => {
    expect(isShared({ shared: false })).toBe(false)
  })
})

// ─── 10. toggleShare ───────────────────────────────────────────────────────────

describe("toggleShare", () => {
  it("returns false when current is true", () => {
    expect(toggleShare(true)).toBe(false)
  })

  it("returns true when current is false", () => {
    expect(toggleShare(false)).toBe(true)
  })
})

// ─── 11. getSharedForToken ─────────────────────────────────────────────────────

describe("getSharedForToken", () => {
  it("returns only shared margins for a valid token", () => {
    const margins = [
      { id: "a", shared: true },
      { id: "b", shared: false },
      { id: "c", shared: true },
    ]
    const result = getSharedForToken(margins, "valid-token-123")
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id)).toEqual(["a", "c"])
  })

  it("returns empty array when token is empty", () => {
    expect(getSharedForToken([{ shared: true }], "")).toEqual([])
    expect(getSharedForToken([{ shared: true }], "   ")).toEqual([])
  })

  it("returns empty array when no margins are shared", () => {
    const margins = [
      { id: "a", shared: false },
      { id: "b", shared: false },
    ]
    expect(getSharedForToken(margins, "token")).toEqual([])
  })

  it("returns empty array for empty margins", () => {
    expect(getSharedForToken([], "token")).toEqual([])
  })
})

describe("legacy margins schema compatibility", () => {
  it("detects missing modern margin columns as a legacy schema error", () => {
    expect(
      isLegacyMarginsSchemaError({
        message: 'column margins.type does not exist',
        details: 'Could not find the type column on public.margins',
      }),
    ).toBe(true)
    expect(isLegacyMarginsSchemaError({ message: "permission denied" })).toBe(false)
  })

  it("normalizes a legacy row to the modern margin shape", () => {
    expect(
      normalizeMarginRecord({
        id: "margin-1",
        writing_id: VALID_UUID,
        reader_id: VALID_UUID,
        anchor_start: 0,
        anchor_end: 5,
        anchor_text: "Hello",
        note: "Legacy note",
        shared: true,
        shared_at: null,
        created_at: "2026-05-28T00:00:00.000Z",
        updated_at: "2026-05-28T00:00:00.000Z",
      }),
    ).toMatchObject({
      type: "personal",
      text: "Legacy note",
      note: "Legacy note",
      archived: false,
      resolved: false,
    })
  })

  it("falls back to legacy upsert/select during write-through sync", async () => {
    const missingColumnsError = {
      message: 'column margins.type does not exist',
      details: 'Could not find the type column on public.margins',
    }

    const upsertCalls: unknown[] = []
    const selectCalls: string[] = []

    const supabase = {
      from: () => ({
        upsert: async (rows: unknown) => {
          upsertCalls.push(rows)
          return upsertCalls.length === 1
            ? { error: missingColumnsError }
            : { error: null }
        },
        delete: () => ({
          eq: () => ({
            eq: () => ({
              not: async () => ({ error: null }),
            }),
          }),
        }),
        select: (query: string) => {
          selectCalls.push(query)
          return {
            eq: () => ({
              eq: () => ({
                order: async () => {
                  if (query.includes("type, text")) {
                    return { data: null, error: missingColumnsError }
                  }

                  return {
                    data: [
                      {
                        id: "margin-1",
                        reader_id: VALID_UUID,
                        writing_id: VALID_UUID,
                        anchor_start: 0,
                        anchor_end: 5,
                        anchor_text: "Hello",
                        note: "Legacy note",
                        shared: false,
                        shared_at: null,
                        created_at: "2026-05-28T00:00:00.000Z",
                        updated_at: "2026-05-28T00:00:00.000Z",
                      },
                    ],
                    error: null,
                  }
                },
              }),
            }),
          }
        },
      }),
    }

    const margins = await syncMarginsFromBodyJson(supabase, {
      bodyJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello", marks: [{ type: "highlight" }] },
              {
                type: "text",
                text: "",
              },
              {
                type: "annotationReference",
                attrs: { id: "margin-1", type: "highlight", index: 1, text: "Legacy note" },
              },
            ],
          },
        ],
      },
      writingId: VALID_UUID,
      readerId: VALID_UUID,
    })

    expect(upsertCalls).toHaveLength(2)
    expect(selectCalls.some((query) => query.includes("type, text"))).toBe(true)
    expect(margins).toEqual([
      expect.objectContaining({
        id: "margin-1",
        type: "personal",
        text: "Legacy note",
        note: "Legacy note",
      }),
    ])
  })
})
