import { describe, expect, it, vi } from "vitest"
import {
  createVocabularyItem,
  deleteVocabularyItem,
  deriveDisabledStatuses,
  setDisabledStatuses,
  updateVocabularyItem,
} from "@/lib/vocabulary/server"
import type { VocabularyItem } from "@/lib/vocabulary/types"

/**
 * A minimal fake of the supabase-js fluent query builder. Every property
 * access returns a callable that keeps chaining; `await`-ing the chain at any
 * point resolves to the response this call was configured with. Good enough
 * to drive `lib/vocabulary/server.ts`, whose calls are always either awaited
 * directly at the end of a chain or via `.single()`/`.maybeSingle()`.
 */
function makeChain(response: unknown) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(response)
      }
      return (..._args: unknown[]) => makeChain(response)
    },
  }
  return new Proxy(() => {}, handler)
}

function makeSupabase(queue: unknown[]) {
  let i = 0
  return {
    from: vi.fn(() => makeChain(queue[i++])),
    rpc: vi.fn(async () => queue[i++]),
  } as unknown as Parameters<typeof createVocabularyItem>[0]
}

const baseRow = {
  id: "row-1",
  kind: "type",
  key: "research",
  name: "Research",
  description: "",
  icon: "compass",
  color: "#5B5BD6",
  hidden: false,
  is_base: false,
  is_required: false,
  position: 7,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
}

describe("createVocabularyItem", () => {
  it("rejects an icon outside the closed set before touching the database", async () => {
    const supabase = makeSupabase([])
    const result = await createVocabularyItem(supabase, "user-1", {
      kind: "type",
      name: "Research",
      icon: "circle-check", // status-only icon
      color: "#5B5BD6",
    })
    expect(result.error?.code).toBe("INVALID_INPUT")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("creates a custom item once base items are materialized and the key is free", async () => {
    const supabase = makeSupabase([
      { error: null }, // ensureBaseItemsMaterialized upsert
      { data: null, error: null }, // nextAvailableKey: key free
      { count: 6 }, // position count
      { data: baseRow, error: null }, // insert
    ])

    const result = await createVocabularyItem(supabase, "user-1", {
      kind: "type",
      name: "Research",
      icon: "compass",
      color: "#5B5BD6",
    })

    expect(result.error).toBeNull()
    expect(result.data?.key).toBe("research")
    expect(result.data?.isBase).toBe(false)
  })
})

describe("deleteVocabularyItem", () => {
  it("rejects deleting an unmaterialized base item without any database call", async () => {
    const supabase = makeSupabase([])
    const result = await deleteVocabularyItem(supabase, "user-1", "base:type:general")
    expect(result.error?.code).toBe("INVALID_INPUT")
    expect(result.error?.message).toContain("base item")
    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("rejects deleting a materialized base item", async () => {
    const supabase = makeSupabase([{ data: { ...baseRow, is_base: true }, error: null }])
    const result = await deleteVocabularyItem(supabase, "user-1", "row-1")
    expect(result.error?.code).toBe("INVALID_INPUT")
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("rewrites affected writings and returns the count on success", async () => {
    const supabase = makeSupabase([
      { data: baseRow, error: null }, // resolveRow
      { data: 3, error: null }, // rpc delete_vocabulary_item -> rewritten count
    ])
    const result = await deleteVocabularyItem(supabase, "user-1", "row-1")
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ rewrittenCount: 3 })
    expect(supabase.rpc).toHaveBeenCalledWith("delete_vocabulary_item", { p_item_id: "row-1" })
  })
})

describe("updateVocabularyItem", () => {
  it("rejects hiding a required item (draft)", async () => {
    const requiredRow = { ...baseRow, kind: "status", key: "draft", is_base: true, is_required: true }
    const supabase = makeSupabase([{ data: requiredRow, error: null }])
    const result = await updateVocabularyItem(supabase, "user-1", "row-1", { hidden: true })
    expect(result.error?.code).toBe("INVALID_INPUT")
    expect(result.error?.message).toContain("required")
  })

  it("rejects a color outside the closed palette", async () => {
    const supabase = makeSupabase([{ data: baseRow, error: null }])
    const result = await updateVocabularyItem(supabase, "user-1", "row-1", { color: "#FF00FF" })
    expect(result.error?.code).toBe("INVALID_INPUT")
  })
})

describe("deriveDisabledStatuses", () => {
  it("returns only hidden status keys, ignoring types and visible statuses", () => {
    const items: VocabularyItem[] = [
      { ...toItem(baseRow), kind: "type", key: "general", hidden: true },
      { ...toItem(baseRow), kind: "status", key: "draft", hidden: false },
      { ...toItem(baseRow), kind: "status", key: "archived", hidden: true },
    ]
    expect(deriveDisabledStatuses(items)).toEqual(["archived"])
  })
})

describe("setDisabledStatuses", () => {
  it("rejects draft without any database call", async () => {
    const supabase = makeSupabase([])
    const result = await setDisabledStatuses(supabase, "user-1", ["draft"])
    expect(result.error?.code).toBe("INVALID_INPUT")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("hides the given statuses, clears the rest, and returns the resulting vocabulary", async () => {
    const supabase = makeSupabase([
      { error: null }, // ensureBaseItemsMaterialized
      { error: null }, // set hidden=true for the given keys
      { error: null }, // clear hidden for the rest
      { data: [baseRow], error: null }, // final listVocabulary
    ])
    const result = await setDisabledStatuses(supabase, "user-1", ["archived"])
    expect(result.error).toBeNull()
    // 13 merged base items (6 types + 7 statuses) plus the one custom row from the mock.
    expect(result.data).toHaveLength(14)
  })
})

function toItem(row: typeof baseRow): VocabularyItem {
  return {
    id: row.id,
    kind: row.kind as VocabularyItem["kind"],
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon as VocabularyItem["icon"],
    color: row.color,
    hidden: row.hidden,
    isBase: row.is_base,
    isRequired: row.is_required,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
